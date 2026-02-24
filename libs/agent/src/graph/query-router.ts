/**
 * Query Router — Tiered Model Selection
 *
 * WHY THIS EXISTS:
 * The ReAct agent pattern makes 2+ separate LLM calls per query (one to decide
 * which tool to call, one to synthesize the result). Using Claude Sonnet for both
 * is expensive: a trivial "how much is AAPL?" lookup costs ~$0.015 because the
 * expensive model is paying for tool schema overhead twice.
 *
 * THE SOLUTION — Two-tier routing:
 *   1. A cheap Haiku call classifies the query (which tools, simple vs complex).
 *      Haiku is ideal here — classification is a text matching task, not reasoning.
 *   2. Simple single-tool lookups run the full ReAct loop on Haiku (~$0.001).
 *   3. Complex multi-tool / analytical queries escalate to Sonnet (~$0.015–0.025).
 *
 * FAILURE MODE IS SAFE:
 * If the router fails for any reason, it returns all tools + 'complex', which
 * causes Sonnet to handle the query. Cost is never less than before; answers
 * are never wrong due to routing errors.
 *
 * RULE-BASED GUARDRAILS:
 * Keyword patterns (e.g. "should i", "compare", "rebalance") force escalation
 * regardless of the LLM's classification. This ensures financial reasoning
 * queries always get Sonnet, even if Haiku underestimates their complexity.
 */
import { ChatAnthropic } from '@langchain/anthropic';

/** Haiku model used for routing — cheap, fast, reliable for classification */
export const HAIKU_MODEL = 'claude-3-haiku-20240307';

/** Sonnet model used for complex analytical queries */
export const SONNET_MODEL = 'claude-sonnet-4-5';

/** Haiku pricing (USD per 1M tokens) */
export const HAIKU_INPUT_COST_PER_M = 0.25;
export const HAIKU_OUTPUT_COST_PER_M = 1.25;

/** Sonnet pricing (USD per 1M tokens) */
export const SONNET_INPUT_COST_PER_M = 3.0;
export const SONNET_OUTPUT_COST_PER_M = 15.0;

export type QueryComplexity = 'simple' | 'complex';

export interface RouterResult {
  /** Subset of tool names the router believes are needed */
  tools: string[];
  /** simple = single tool lookup; complex = multi-tool or analytical reasoning */
  complexity: QueryComplexity;
  /** Tokens consumed by the router call itself (used for cost accounting) */
  routerInputTokens: number;
  routerOutputTokens: number;
}

/**
 * Short tool catalog sent to the router.
 * Intentionally omits full Zod schemas — the router only needs names + one-liners.
 * This keeps router input at ~150 tokens instead of ~1,000.
 */
const TOOL_CATALOG = [
  {
    name: 'portfolio_analysis',
    description:
      "User's current holdings, sector allocation, and performance metrics"
  },
  {
    name: 'market_data',
    description:
      'Current or historical prices for specific ticker symbols (e.g. AAPL, BTC)'
  },
  {
    name: 'transaction_categorize',
    description: "User's buy/sell/dividend/fee transaction history"
  },
  {
    name: 'tax_estimate',
    description:
      'Rough US tax liability estimate for a given year (mocked, informational)'
  },
  {
    name: 'compliance_check',
    description:
      'US regulatory compliance checks on transactions (mocked, informational)'
  }
];

const ALL_TOOL_NAMES = TOOL_CATALOG.map((t) => t.name);

/**
 * Keywords that indicate a query requires financial reasoning rather than
 * a simple data lookup. If any keyword is found, we force complexity='complex'
 * regardless of Haiku's classification.
 */
const COMPLEXITY_ESCALATION_KEYWORDS = [
  'should i',
  'compare',
  'versus',
  ' vs ',
  'analyze',
  'analysis',
  'why',
  'recommend',
  'rebalance',
  'better',
  'worse',
  'strategy',
  'optimize',
  'risk',
  'if i',
  'what would',
  'forecast',
  'project',
  'allocation',
  'diversif',
  'cost basis',
  'tax loss',
  'harvest'
];

function buildRouterPrompt(query: string): string {
  const toolList = TOOL_CATALOG.map(
    (t) => `- ${t.name}: ${t.description}`
  ).join('\n');

  return `You are a query router for a financial assistant. Given a user query, determine:
1. Which tools are needed to answer it (pick from the list below)
2. Whether the query is "simple" or "complex"

Available tools:
${toolList}

Classification rules:
- "simple": requires exactly 1 tool AND the answer is a direct data lookup (e.g. current price, account balance, list of recent transactions)
- "complex": requires 2+ tools, OR involves financial reasoning, comparison, analysis, recommendations, or hypotheticals

Respond ONLY with valid JSON on a single line, no other text:
{"tools": ["tool_name_here"], "complexity": "simple"}

User query: "${query}"`;
}

/**
 * Routes a user query to the appropriate tools and complexity tier.
 *
 * Uses Claude 3 Haiku (~$0.0001 per call) to classify the query, then
 * applies rule-based keyword overrides to prevent under-estimation of complexity.
 *
 * Never throws — on any error, returns the safe fallback (all tools + complex).
 */
export async function routeQuery(query: string): Promise<RouterResult> {
  const safeDefault: RouterResult = {
    tools: ALL_TOOL_NAMES,
    complexity: 'complex',
    routerInputTokens: 0,
    routerOutputTokens: 0
  };

  // Rule-based keyword check — runs before LLM to ensure Sonnet gets complex queries
  const queryLower = query.toLowerCase();
  const keywordForcesComplex = COMPLEXITY_ESCALATION_KEYWORDS.some((kw) =>
    queryLower.includes(kw)
  );

  let routerInputTokens = 0;
  let routerOutputTokens = 0;

  try {
    const router = new ChatAnthropic({
      model: HAIKU_MODEL,
      temperature: 0,
      maxTokens: 128 // Router output is a single JSON line; 128 tokens is more than enough
    });

    const response = await router.invoke([
      { role: 'user', content: buildRouterPrompt(query) }
    ]);

    // Capture Haiku's token usage for cost accounting
    const usage = (
      response as {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      }
    ).usage_metadata;

    routerInputTokens = usage?.input_tokens ?? 0;
    routerOutputTokens = usage?.output_tokens ?? 0;

    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON — Haiku occasionally adds surrounding text despite instructions
    const jsonMatch = content.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      console.warn(
        '[QueryRouter] No JSON in router response; falling back to Sonnet'
      );
      return { ...safeDefault, routerInputTokens, routerOutputTokens };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      tools?: string[];
      complexity?: string;
    };

    // Validate tool names — discard any hallucinated tool names
    const validTools = (parsed.tools ?? []).filter((t) =>
      ALL_TOOL_NAMES.includes(t)
    );
    if (validTools.length === 0) {
      console.warn(
        '[QueryRouter] Router returned no valid tools; falling back to Sonnet'
      );
      return { ...safeDefault, routerInputTokens, routerOutputTokens };
    }

    // Determine final complexity:
    // - Rule-based keywords OR multiple tools always escalate to complex
    // - Otherwise trust the router's classification
    const complexity: QueryComplexity =
      keywordForcesComplex || validTools.length > 1
        ? 'complex'
        : (parsed.complexity as QueryComplexity) === 'simple'
          ? 'simple'
          : 'complex'; // default to complex if unparseable

    return {
      tools: validTools,
      complexity,
      routerInputTokens,
      routerOutputTokens
    };
  } catch (err) {
    console.error('[QueryRouter] Router failed; falling back to Sonnet:', err);
    return { ...safeDefault, routerInputTokens, routerOutputTokens };
  }
}

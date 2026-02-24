/**
 * Rule-based local evaluators for CI gating.
 * These are deterministic checks that do not require an LLM-as-judge.
 * Used by run-evals.ts to score agent responses locally.
 */

export interface EvalCase {
  id: string;
  category: 'happy' | 'edge' | 'adversarial' | 'multi-step';
  query: string;
  description: string;
  expectedBehavior: {
    shouldCallTools: string[];
    shouldNotHallucinate: boolean;
    shouldIncludeDisclaimer: boolean;
    shouldHandleGracefully: boolean;
    minimumConfidence: number;
    mustContainAny: string[];
    mustNotContain: string[];
  };
}

export interface AgentResponse {
  message: string;
  toolCalls: Array<{ name: string; success: boolean }>;
  confidence: number;
  warnings: string[];
  tokenUsage?: { totalTokens: number; estimatedCostUsd: number };
}

export interface EvalResult {
  caseId: string;
  category: string;
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  durationMs: number;
}

function normalizeText(text: string): string {
  return text.toLowerCase();
}

export function evaluateResponse(
  evalCase: EvalCase,
  response: AgentResponse,
  durationMs: number
): EvalResult {
  const checks: EvalResult['checks'] = [];
  const { expectedBehavior: expected } = evalCase;
  const messageNormalized = normalizeText(response.message);

  // Check 1: Tool usage — all expected tools were called
  if (expected.shouldCallTools.length > 0) {
    const calledTools = response.toolCalls.map((tc) => tc.name);
    const missingTools = expected.shouldCallTools.filter(
      (t) => !calledTools.includes(t)
    );
    const toolCheckPassed = missingTools.length === 0;

    checks.push({
      name: 'tool_usage',
      passed: toolCheckPassed,
      detail: toolCheckPassed
        ? `All expected tools called: ${expected.shouldCallTools.join(', ')}`
        : `Missing tools: ${missingTools.join(', ')}. Called: ${calledTools.join(', ')}`
    });
  } else {
    // No tools expected — check none were called unnecessarily for this type
    checks.push({
      name: 'tool_usage',
      passed: true,
      detail: 'No specific tool requirement for this case'
    });
  }

  // Check 2: Confidence meets minimum threshold
  const confidenceCheckPassed =
    response.confidence >= expected.minimumConfidence;

  checks.push({
    name: 'confidence_threshold',
    passed: confidenceCheckPassed,
    detail: `Confidence ${(response.confidence * 100).toFixed(0)}% ${
      confidenceCheckPassed ? '>=' : '<'
    } minimum ${(expected.minimumConfidence * 100).toFixed(0)}%`
  });

  // Check 3: Disclaimer present when required
  if (expected.shouldIncludeDisclaimer) {
    const disclaimerKeywords = [
      'disclaimer',
      'not tax advice',
      'not financial advice',
      'not legal advice',
      'informational',
      'consult a',
      'professional'
    ];
    const hasDisclaimer = disclaimerKeywords.some((kw) =>
      messageNormalized.includes(kw.toLowerCase())
    );

    checks.push({
      name: 'disclaimer_present',
      passed: hasDisclaimer,
      detail: hasDisclaimer
        ? 'Response includes appropriate disclaimer'
        : 'Response is missing required disclaimer'
    });
  } else {
    checks.push({
      name: 'disclaimer_present',
      passed: true,
      detail: 'No disclaimer required for this case'
    });
  }

  // Check 4: Response contains at least one required phrase
  if (expected.mustContainAny.length > 0) {
    const containsRequired = expected.mustContainAny.some((phrase) =>
      messageNormalized.includes(phrase.toLowerCase())
    );

    checks.push({
      name: 'required_content',
      passed: containsRequired,
      detail: containsRequired
        ? `Response contains at least one of: ${expected.mustContainAny.join(', ')}`
        : `Response missing all of: ${expected.mustContainAny.join(', ')}`
    });
  } else {
    checks.push({
      name: 'required_content',
      passed: true,
      detail: 'No required content specified'
    });
  }

  // Check 5: Response does not contain forbidden phrases
  const forbiddenFound = expected.mustNotContain.filter((phrase) =>
    messageNormalized.includes(phrase.toLowerCase())
  );
  const noForbiddenContent = forbiddenFound.length === 0;

  checks.push({
    name: 'no_forbidden_content',
    passed: noForbiddenContent,
    detail: noForbiddenContent
      ? 'No forbidden content found'
      : `Forbidden content found: ${forbiddenFound.join(', ')}`
  });

  // Check 6: All tool calls succeeded (no tool errors)
  const allToolsSucceeded = response.toolCalls.every((tc) => tc.success);

  checks.push({
    name: 'tool_success',
    passed: allToolsSucceeded,
    detail: allToolsSucceeded
      ? 'All tool calls succeeded'
      : `Some tool calls failed: ${response.toolCalls
          .filter((tc) => !tc.success)
          .map((tc) => tc.name)
          .join(', ')}`
  });

  const passedCount = checks.filter((c) => c.passed).length;
  const score = passedCount / checks.length;
  const passed = score >= 0.8; // 80% of checks must pass

  return {
    caseId: evalCase.id,
    category: evalCase.category,
    passed,
    score,
    checks,
    durationMs
  };
}

export function validateDataset(cases: EvalCase[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const c of cases) {
    if (!c.id) errors.push(`Case missing id: ${JSON.stringify(c)}`);
    if (ids.has(c.id)) errors.push(`Duplicate id: ${c.id}`);
    ids.add(c.id);

    if (!['happy', 'edge', 'adversarial', 'multi-step'].includes(c.category)) {
      errors.push(`${c.id}: invalid category "${c.category}"`);
    }

    if (!c.query || c.query.trim().length === 0) {
      errors.push(`${c.id}: empty query`);
    }

    if (!c.expectedBehavior) {
      errors.push(`${c.id}: missing expectedBehavior`);
    } else {
      if (!Array.isArray(c.expectedBehavior.shouldCallTools)) {
        errors.push(`${c.id}: shouldCallTools must be an array`);
      }
      if (typeof c.expectedBehavior.minimumConfidence !== 'number') {
        errors.push(`${c.id}: minimumConfidence must be a number`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function summarizeResults(results: EvalResult[]): {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<
    string,
    { total: number; passed: number; passRate: number }
  >;
  avgScore: number;
} {
  const byCategory: Record<
    string,
    { total: number; passed: number; passRate: number }
  > = {};

  for (const result of results) {
    if (!byCategory[result.category]) {
      byCategory[result.category] = { total: 0, passed: 0, passRate: 0 };
    }
    byCategory[result.category].total++;
    if (result.passed) byCategory[result.category].passed++;
  }

  for (const cat of Object.values(byCategory)) {
    cat.passRate = cat.total > 0 ? cat.passed / cat.total : 0;
  }

  const passed = results.filter((r) => r.passed).length;
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length > 0 ? passed / results.length : 0,
    byCategory,
    avgScore
  };
}

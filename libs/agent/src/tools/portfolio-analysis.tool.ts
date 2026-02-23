import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { format } from 'date-fns';

import {
  PortfolioAnalysisInput,
  PortfolioAnalysisInputSchema,
  PortfolioAnalysisOutput
} from '../schemas/portfolio-analysis.schema';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

async function analyzePortfolio(
  input: PortfolioAnalysisInput,
  portfolioService: PortfolioService,
  userId: string
): Promise<PortfolioAnalysisOutput> {
  const warnings: string[] = [];

  const filters = input.accountId
    ? [{ id: input.accountId, type: 'ACCOUNT' as const }]
    : [];

  const [details, performance] = await Promise.all([
    portfolioService.getDetails({
      filters,
      impersonationId: userId,
      userId
    }),
    portfolioService.getPerformance({
      filters,
      impersonationId: userId,
      userId
    })
  ]);

  if (details.hasErrors) {
    warnings.push('Some portfolio data could not be fetched completely.');
  }

  const holdings = Object.values(details.holdings ?? {}).map((h) => ({
    symbol: h.symbol,
    quantity: h.quantity ?? 0,
    value: h.valueInBaseCurrency ?? 0
  }));

  const allocationMap = new Map<string, number>();
  let totalValue = 0;

  for (const holding of Object.values(details.holdings ?? {})) {
    const val = holding.valueInBaseCurrency ?? 0;
    totalValue += val;

    const key = holding.sectors?.[0]?.name ?? holding.assetClass ?? 'UNKNOWN';

    if (!holding.sectors?.[0]?.name && !holding.assetClass) {
      warnings.push(
        `Holding ${holding.symbol} is missing sector and assetClass; using "UNKNOWN".`
      );
    }

    allocationMap.set(key, (allocationMap.get(key) ?? 0) + val);
  }

  const allocation = Array.from(allocationMap.entries()).map(
    ([label, value]) => {
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return {
        assetClass: label,
        percentage: pct,
        sector: label !== 'UNKNOWN' ? label : undefined
      };
    }
  );

  const perf = performance.performance;
  const totalReturn =
    perf.totalInvestment > 0
      ? (perf.netPerformance / perf.totalInvestment) * 100
      : 0;

  const ytdReturn = perf.netPerformancePercentage ?? 0;

  return {
    baseCurrency: 'USD',
    asOf: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    holdings,
    allocation,
    performance: {
      totalReturn,
      ytdReturn
    },
    warnings
  };
}

export function createPortfolioAnalysisTool(
  portfolioService: PortfolioService,
  userId: string
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    description:
      'Analyze a user portfolio: returns holdings, sector/asset-class allocation, and performance metrics (total return, YTD). Use this for any question about portfolio value, holdings, diversification, or performance.',
    func: async (input: PortfolioAnalysisInput): Promise<string> => {
      const result = await executeWithRetry(() =>
        analyzePortfolio(input, portfolioService, userId)
      );

      return JSON.stringify(result);
    },
    name: 'portfolio_analysis',
    schema: PortfolioAnalysisInputSchema as any
  });
}

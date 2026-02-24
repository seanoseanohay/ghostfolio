import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { DataSource } from '@prisma/client';
import { format, parseISO } from 'date-fns';

import {
  MarketDataInput,
  MarketDataInputSchema,
  MarketDataOutput
} from '../schemas/market-data.schema';

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

async function fetchMarketData(
  input: MarketDataInput,
  dataProviderService: DataProviderService
): Promise<MarketDataOutput> {
  const warnings: string[] = [];
  const dataSourceEnum =
    DataSource[input.dataSource as keyof typeof DataSource] ?? DataSource.YAHOO;

  const items = input.symbols.map((symbol) => ({
    dataSource: dataSourceEnum,
    symbol
  }));

  const quotesRaw = await dataProviderService.getQuotes({ items });

  const quotes = input.symbols.map((symbol) => {
    const q = quotesRaw[symbol];

    if (!q) {
      warnings.push(`No quote data returned for symbol: ${symbol}`);

      return {
        symbol,
        currency: 'N/A',
        marketPrice: 0,
        marketState: 'unknown',
        dataSource: input.dataSource
      };
    }

    return {
      symbol,
      currency: q.currency ?? 'N/A',
      marketPrice: q.marketPrice ?? 0,
      marketState: q.marketState ?? 'unknown',
      dataSource: String(q.dataSource ?? input.dataSource)
    };
  });

  let historical: Record<string, Record<string, number>> | undefined;

  if (input.includeHistorical) {
    if (!input.fromDate) {
      warnings.push(
        'includeHistorical is true but fromDate was not provided; skipping historical data.'
      );
    } else {
      const from = parseISO(input.fromDate);
      const to = input.toDate ? parseISO(input.toDate) : new Date();

      const historicalRaw = await dataProviderService.getHistorical(
        items,
        'day',
        from,
        to
      );

      historical = {};

      for (const [symbol, dateMap] of Object.entries(historicalRaw)) {
        historical[symbol] = {};

        for (const [date, data] of Object.entries(dateMap)) {
          historical[symbol][date] = data.marketPrice;
        }
      }
    }
  }

  return {
    asOf: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    quotes,
    historical,
    warnings
  };
}

export function createMarketDataTool(
  dataProviderService: DataProviderService
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    description:
      'Fetch current market quotes and optionally historical price data for one or more ticker symbols. Use this to answer questions about current stock prices, cryptocurrency values, or historical performance of specific securities.',
    func: async (input: MarketDataInput): Promise<string> => {
      const result = await executeWithRetry(() =>
        fetchMarketData(input, dataProviderService)
      );

      return JSON.stringify(result);
    },
    name: 'market_data',
    schema: MarketDataInputSchema as any
  });
}

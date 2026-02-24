import { z } from 'zod';

export const MarketDataInputSchema = z.object({
  symbols: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe(
      'List of ticker symbols to fetch market data for (e.g. ["AAPL", "MSFT", "BTC"]). Maximum 20.'
    ),
  dataSource: z
    .enum(['YAHOO', 'COINGECKO', 'MANUAL'])
    .optional()
    .default('YAHOO')
    .describe(
      'Data source to use. Defaults to YAHOO. Use COINGECKO for cryptocurrencies.'
    ),
  includeHistorical: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include historical price data.'),
  fromDate: z
    .string()
    .optional()
    .describe(
      'Start date for historical data in YYYY-MM-DD format. Required if includeHistorical is true.'
    ),
  toDate: z
    .string()
    .optional()
    .describe(
      'End date for historical data in YYYY-MM-DD format. Defaults to today.'
    )
});

export const MarketDataQuoteSchema = z.object({
  symbol: z.string(),
  currency: z.string(),
  marketPrice: z.number(),
  marketState: z.string(),
  dataSource: z.string()
});

export const MarketDataOutputSchema = z.object({
  asOf: z.string(),
  quotes: z.array(MarketDataQuoteSchema),
  historical: z
    .record(z.string(), z.record(z.string(), z.number()))
    .optional()
    .describe('Map of symbol → date → marketPrice'),
  warnings: z.array(z.string()).default([])
});

export type MarketDataInput = z.infer<typeof MarketDataInputSchema>;
export type MarketDataOutput = z.infer<typeof MarketDataOutputSchema>;

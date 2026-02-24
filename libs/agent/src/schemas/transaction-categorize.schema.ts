import { z } from 'zod';

export const TransactionCategorizeInputSchema = z.object({
  startDate: z
    .string()
    .optional()
    .describe('Start date filter in YYYY-MM-DD format (inclusive).'),
  endDate: z
    .string()
    .optional()
    .describe('End date filter in YYYY-MM-DD format (inclusive).'),
  types: z
    .array(
      z.enum([
        'BUY',
        'SELL',
        'DIVIDEND',
        'INTEREST',
        'FEE',
        'ITEM',
        'LIABILITY'
      ])
    )
    .optional()
    .describe(
      'Filter by activity types. Omit to return all types. Useful for e.g. only dividends or only buy/sell transactions.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum number of transactions to return. Defaults to 50.')
});

export const TransactionSummarySchema = z.object({
  type: z.string(),
  count: z.number(),
  totalValueInBaseCurrency: z.number(),
  totalFeeInBaseCurrency: z.number()
});

export const TransactionItemSchema = z.object({
  date: z.string(),
  type: z.string(),
  symbol: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  fee: z.number(),
  currency: z.string(),
  valueInBaseCurrency: z.number(),
  accountName: z.string().optional()
});

export const TransactionCategorizeOutputSchema = z.object({
  asOf: z.string(),
  totalCount: z.number(),
  summary: z.array(TransactionSummarySchema),
  transactions: z.array(TransactionItemSchema),
  warnings: z.array(z.string()).default([])
});

export type TransactionCategorizeInput = z.infer<
  typeof TransactionCategorizeInputSchema
>;
export type TransactionCategorizeOutput = z.infer<
  typeof TransactionCategorizeOutputSchema
>;

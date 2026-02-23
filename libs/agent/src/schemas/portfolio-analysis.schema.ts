import { z } from 'zod';

export const PortfolioAnalysisInputSchema = z.object({
  accountId: z
    .string()
    .optional()
    .describe(
      'Optional account ID to analyze. Defaults to the most recently updated account.'
    )
});

export const HoldingSchema = z.object({
  symbol: z.string(),
  quantity: z.number(),
  value: z.number()
});

export const AllocationSchema = z.object({
  sector: z.string().optional(),
  assetClass: z.string().optional(),
  percentage: z.number()
});

export const PerformanceSchema = z.object({
  totalReturn: z.number(),
  ytdReturn: z.number()
});

export const PortfolioAnalysisOutputSchema = z.object({
  baseCurrency: z.string(),
  asOf: z.string(),
  holdings: z.array(HoldingSchema),
  allocation: z.array(AllocationSchema),
  performance: PerformanceSchema,
  warnings: z.array(z.string()).optional().default([])
});

export type PortfolioAnalysisInput = z.infer<
  typeof PortfolioAnalysisInputSchema
>;
export type PortfolioAnalysisOutput = z.infer<
  typeof PortfolioAnalysisOutputSchema
>;

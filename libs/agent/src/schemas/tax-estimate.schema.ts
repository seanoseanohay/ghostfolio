import { z } from 'zod';

export const TaxEstimateInputSchema = z.object({
  taxYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .describe('The tax year to estimate for (e.g. 2024).'),
  country: z
    .string()
    .length(2)
    .optional()
    .default('US')
    .describe(
      'ISO 3166-1 alpha-2 country code. Currently only US is supported.'
    )
});

export const TaxEstimateOutputSchema = z.object({
  taxYear: z.number(),
  country: z.string(),
  estimatedCapitalGains: z
    .number()
    .describe('Estimated realized capital gains in base currency'),
  estimatedDividendIncome: z
    .number()
    .describe('Estimated dividend income in base currency'),
  estimatedTaxLiability: z
    .number()
    .describe('Rough estimated tax liability (mocked)'),
  disclaimer: z.string(),
  warnings: z.array(z.string()).default([])
});

export type TaxEstimateInput = z.infer<typeof TaxEstimateInputSchema>;
export type TaxEstimateOutput = z.infer<typeof TaxEstimateOutputSchema>;

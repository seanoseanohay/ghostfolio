import { z } from 'zod';

export const ComplianceCheckInputSchema = z.object({
  checkType: z
    .enum([
      'DIVERSIFICATION',
      'CONCENTRATION_RISK',
      'REGULATORY_LIMITS',
      'GENERAL'
    ])
    .optional()
    .default('GENERAL')
    .describe(
      'Type of compliance check to perform. DIVERSIFICATION checks portfolio spread. CONCENTRATION_RISK checks single-position exposure. REGULATORY_LIMITS checks common US regulatory thresholds. GENERAL performs all checks.'
    ),
  country: z
    .string()
    .length(2)
    .optional()
    .default('US')
    .describe(
      'ISO 3166-1 alpha-2 country code for jurisdiction-specific rules. Currently only US is supported.'
    )
});

export const ComplianceCheckItemSchema = z.object({
  checkName: z.string(),
  passed: z.boolean(),
  detail: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL'])
});

export const ComplianceCheckOutputSchema = z.object({
  asOf: z.string(),
  country: z.string(),
  checkType: z.string(),
  checks: z.array(ComplianceCheckItemSchema),
  overallPassed: z.boolean(),
  disclaimer: z.string(),
  warnings: z.array(z.string()).default([])
});

export type ComplianceCheckInput = z.infer<typeof ComplianceCheckInputSchema>;
export type ComplianceCheckOutput = z.infer<typeof ComplianceCheckOutputSchema>;

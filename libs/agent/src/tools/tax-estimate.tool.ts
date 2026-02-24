import { DynamicStructuredTool } from '@langchain/core/tools';

import {
  TaxEstimateInput,
  TaxEstimateInputSchema,
  TaxEstimateOutput
} from '../schemas/tax-estimate.schema';

const DISCLAIMER =
  'IMPORTANT: This is a rough, mocked estimate for informational purposes only. It does not constitute tax advice. Consult a qualified tax professional for accurate tax calculations. Ghostfolio is not responsible for any tax decisions made based on this data.';

function estimateTax(input: TaxEstimateInput): TaxEstimateOutput {
  const warnings: string[] = [];

  if (input.country !== 'US') {
    warnings.push(
      `Tax estimation is currently only supported for the US. Results for "${input.country}" are not available.`
    );

    return {
      taxYear: input.taxYear,
      country: input.country,
      estimatedCapitalGains: 0,
      estimatedDividendIncome: 0,
      estimatedTaxLiability: 0,
      disclaimer: DISCLAIMER,
      warnings
    };
  }

  // Mocked values — a real implementation would call OrderService to sum realized gains
  const estimatedCapitalGains = 0;
  const estimatedDividendIncome = 0;
  const estimatedTaxLiability = 0;

  warnings.push(
    'Tax estimation requires realized gains data. This feature will be enhanced in a future version to calculate actual gains from your transaction history.'
  );

  return {
    taxYear: input.taxYear,
    country: input.country,
    estimatedCapitalGains,
    estimatedDividendIncome,
    estimatedTaxLiability,
    disclaimer: DISCLAIMER,
    warnings
  };
}

export function createTaxEstimateTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    description:
      'Provide a rough tax estimate for a given tax year. Currently mocked for US only. Returns estimated capital gains, dividend income, and a ballpark tax liability. Always includes a disclaimer — this is not tax advice.',
    func: async (input: TaxEstimateInput): Promise<string> => {
      const result = estimateTax(input);

      return JSON.stringify(result);
    },
    name: 'tax_estimate',
    schema: TaxEstimateInputSchema as any
  });
}

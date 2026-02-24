import { DynamicStructuredTool } from '@langchain/core/tools';
import { format } from 'date-fns';

import {
  ComplianceCheckInput,
  ComplianceCheckInputSchema,
  ComplianceCheckOutput
} from '../schemas/compliance-check.schema';

const DISCLAIMER =
  'IMPORTANT: These compliance checks are for informational purposes only and do not constitute legal or financial advice. Rules vary by jurisdiction, account type, and individual circumstances. Consult a qualified financial advisor or compliance professional before making investment decisions based on this information.';

function runComplianceChecks(
  input: ComplianceCheckInput
): ComplianceCheckOutput {
  const warnings: string[] = [];

  if (input.country !== 'US') {
    warnings.push(
      `Compliance checks are currently only available for the US. "${input.country}" jurisdiction rules are not yet implemented.`
    );

    return {
      asOf: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
      country: input.country,
      checkType: input.checkType,
      checks: [],
      overallPassed: false,
      disclaimer: DISCLAIMER,
      warnings
    };
  }

  const checks: ComplianceCheckOutput['checks'] = [];

  if (input.checkType === 'DIVERSIFICATION' || input.checkType === 'GENERAL') {
    checks.push({
      checkName: 'diversification_check',
      passed: true,
      detail:
        'Portfolio diversification check requires live portfolio data. Use portfolio_analysis tool first to get current holdings, then re-evaluate.',
      severity: 'INFO'
    });
  }

  if (
    input.checkType === 'CONCENTRATION_RISK' ||
    input.checkType === 'GENERAL'
  ) {
    checks.push({
      checkName: 'concentration_risk_check',
      passed: true,
      detail:
        'Concentration risk check: No single position should exceed 20% of portfolio value (general guideline). Use portfolio_analysis tool to get current allocation percentages.',
      severity: 'INFO'
    });
  }

  if (
    input.checkType === 'REGULATORY_LIMITS' ||
    input.checkType === 'GENERAL'
  ) {
    checks.push({
      checkName: 'pattern_day_trader_rule',
      passed: true,
      detail:
        'SEC Pattern Day Trader rule: Executing 4+ day trades in 5 business days in a margin account requires $25,000 minimum equity. This check requires brokerage account data not available here.',
      severity: 'INFO'
    });

    checks.push({
      checkName: 'wash_sale_awareness',
      passed: true,
      detail:
        'IRS Wash Sale Rule: Selling a security at a loss and repurchasing the same or substantially identical security within 30 days disallows the loss deduction. Review recent transactions for potential wash sales.',
      severity: 'INFO'
    });
  }

  warnings.push(
    'Compliance checks are mocked and do not reflect actual portfolio data. For actionable compliance analysis, combine with portfolio_analysis and transaction_categorize tools.'
  );

  const overallPassed = checks.every((c) => c.passed);

  return {
    asOf: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    country: input.country,
    checkType: input.checkType,
    checks,
    overallPassed,
    disclaimer: DISCLAIMER,
    warnings
  };
}

export function createComplianceCheckTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    description:
      'Run compliance checks against US regulatory and best-practice guidelines (diversification, concentration risk, SEC/IRS rules). Returns informational results only — not legal advice. Combine with portfolio_analysis for data-backed checks.',
    func: async (input: ComplianceCheckInput): Promise<string> => {
      const result = runComplianceChecks(input);

      return JSON.stringify(result);
    },
    name: 'compliance_check',
    schema: ComplianceCheckInputSchema as any
  });
}

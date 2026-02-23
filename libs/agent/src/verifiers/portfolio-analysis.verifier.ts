import { PortfolioAnalysisOutput } from '../schemas/portfolio-analysis.schema';

export interface VerificationResult {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  warnings: string[];
}

/**
 * Domain verifier for portfolio_analysis output.
 * Runs ≥3 deterministic checks before the response is returned to the user.
 */
export function verifyPortfolioAnalysis(
  output: PortfolioAnalysisOutput
): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  const warnings: string[] = [];

  // Check 1: baseCurrency and asOf are present
  const hasCurrencyAndDate =
    typeof output.baseCurrency === 'string' &&
    output.baseCurrency.length === 3 &&
    typeof output.asOf === 'string' &&
    output.asOf.length > 0;

  checks.push({
    name: 'required_fields_present',
    passed: hasCurrencyAndDate,
    detail: hasCurrencyAndDate
      ? 'baseCurrency and asOf are present'
      : 'baseCurrency or asOf is missing'
  });

  if (!hasCurrencyAndDate) {
    warnings.push('Portfolio response is missing required currency or date.');
  }

  // Check 2: allocation percentages sum to ~100% (within 1% tolerance for rounding)
  const allocationSum = output.allocation.reduce(
    (sum, a) => sum + (a.percentage ?? 0),
    0
  );
  const allocationSumsCorrectly =
    output.allocation.length === 0 || Math.abs(allocationSum - 100) < 1.5;

  checks.push({
    name: 'allocation_sums_to_100',
    passed: allocationSumsCorrectly,
    detail: `Allocation sum: ${allocationSum.toFixed(2)}%`
  });

  if (!allocationSumsCorrectly) {
    warnings.push(
      `Allocation percentages sum to ${allocationSum.toFixed(1)}%, expected ~100%.`
    );
  }

  // Check 3: holdings have non-negative values
  const holdingsValid = output.holdings.every(
    (h) => h.quantity >= 0 && h.value >= 0
  );

  checks.push({
    name: 'holdings_non_negative',
    passed: holdingsValid,
    detail: holdingsValid
      ? 'All holdings have non-negative quantities and values'
      : 'Some holdings have negative quantity or value'
  });

  if (!holdingsValid) {
    warnings.push('One or more holdings have invalid negative values.');
  }

  // Check 4: no UNKNOWN allocations without warning (informational)
  const hasUnknown = output.allocation.some(
    (a) => a.assetClass === 'UNKNOWN' || a.sector === 'UNKNOWN'
  );

  checks.push({
    name: 'no_unknown_allocations',
    passed: !hasUnknown,
    detail: hasUnknown
      ? 'Some allocations use UNKNOWN classification'
      : 'All allocations are classified'
  });

  if (hasUnknown) {
    warnings.push(
      'Some holdings could not be classified into a sector or asset class.'
    );
  }

  // Check 4 is informational; weight checks 1-3 equally (each 33.3%)
  const coreChecks = checks.slice(0, 3);
  const corePassedCount = coreChecks.filter((c) => c.passed).length;
  const score = corePassedCount / coreChecks.length;

  return {
    passed: score >= 0.8,
    score,
    checks,
    warnings: [...(output.warnings ?? []), ...warnings]
  };
}

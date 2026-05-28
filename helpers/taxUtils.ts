export interface WinTaxCategory {
  amount: number;
  percentage: number;
}

/**
 * Progressive compound win-tax with optional payin deductible.
 *
 * Formula:
 *   taxBase  = isDeductible ? (winAmount - payinAmount) : winAmount
 *   For each tier (sorted ascending), tax the band it owns:
 *     band = min(taxBase, nextTier.amount) - tier.amount
 *     last tier: band = taxBase - tier.amount
 *   rawTax = Σ band × (tier.percentage / 100)
 *   winTax = Math.round(rawTax)   → whole €, rounds half-up
 */
export function calcTax(
  winAmount: number,
  payinAmount: number,
  categories: WinTaxCategory[],
  isDeductible: boolean
): number {
  const taxBase = isDeductible ? Math.max(0, winAmount - payinAmount) : winAmount;
  const tiers   = [...categories].sort((a, b) => a.amount - b.amount);
  let rawTax = 0;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (taxBase <= tier.amount) break;
    const nextFloor = tiers[i + 1]?.amount ?? Infinity;
    const band      = Math.min(taxBase, nextFloor) - tier.amount;
    rawTax += band * (tier.percentage / 100);
  }
  return Math.round(rawTax);
}

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

/** Per-unit gross spread; not profit after freight, ads, fees, taxes or returns. */
export function productMargin(pricePyg: number, unitCostPyg: number | null) {
  if (unitCostPyg === null) return null;
  const spreadPyg = pricePyg - unitCostPyg;
  return {
    spreadPyg,
    marginPercent: pricePyg > 0 ? (spreadPyg / pricePyg) * 100 : null,
    markupPercent: unitCostPyg > 0 ? (spreadPyg / unitCostPyg) * 100 : null,
  };
}

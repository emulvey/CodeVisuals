const REGIONAL_TAX_RATES: Record<string, number> = {
  US: 0.0825,
  EU: 0.2,
  UK: 0.2
};

export function fetchTaxRate(region: string): number {
  return REGIONAL_TAX_RATES[region] ?? 0.08;
}

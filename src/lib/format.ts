// Small formatting helpers with no dependencies, safe to use anywhere (including the matching engine).

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2, notation: 'compact' });
/** "$5.9M", "$450K". */
export const formatPrice = (n: number) => money.format(n);

/** "40–80 ac", "40+ ac", "up to 80 ac" or "". */
export function rangeLabel(min: number | undefined, max: number | undefined, unit: string, fmt: (n: number) => string = String) {
  if (min != null && max != null) return min === max ? `${fmt(min)} ${unit}` : `${fmt(min)}–${fmt(max)} ${unit}`;
  if (min != null) return `${fmt(min)}+ ${unit}`;
  if (max != null) return `up to ${fmt(max)} ${unit}`;
  return '';
}

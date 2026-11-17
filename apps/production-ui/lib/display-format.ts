type DisplayNumberOptions = {
  useGrouping?: boolean;
};

function finiteNumber(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatDisplayNumber(
  value: number | string | null | undefined,
  maximumFractionDigits = 2,
  options: DisplayNumberOptions = {},
) {
  const numeric = finiteNumber(value);
  if (numeric === null) return "—";

  return new Intl.NumberFormat("ja-JP", {
    useGrouping: options.useGrouping ?? true,
    maximumFractionDigits: Math.max(0, maximumFractionDigits),
  }).format(numeric);
}

export function formatDisplayQuantity(value: number | string | null | undefined) {
  return formatDisplayNumber(value, 4);
}

/**
 * Prices are rendered without grouping because they are usually paired with a
 * symbol. Keep enough precision for sub-dollar assets, but never expose the
 * raw eight-decimal venue payload in a dashboard card.
 */
export function formatDisplayPrice(value: number | string | null | undefined) {
  const numeric = finiteNumber(value);
  if (numeric === null) return "取引所未返却";

  const abs = Math.abs(numeric);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return formatDisplayNumber(numeric, digits, { useGrouping: false });
}

/** Value is already in percentage points, not a 0..1 fraction. */
export function formatDisplayPercent(value: number | string | null | undefined) {
  const numeric = finiteNumber(value);
  if (numeric === null) return "—";
  const rounded = Number(numeric.toFixed(2));
  return `${formatDisplayNumber(Object.is(rounded, -0) ? 0 : rounded, 2)}%`;
}

/** Convert a fractional rate such as 0.0227 into a percentage label. */
export function formatDisplayFractionPercent(value: number | string | null | undefined) {
  const numeric = finiteNumber(value);
  return numeric === null ? "—" : formatDisplayPercent(numeric * 100);
}

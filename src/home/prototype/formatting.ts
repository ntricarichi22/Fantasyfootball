// Format display values only; calculations and fixture IDs stay numeric.
export function formatNumber(value: number | string) {
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value)) return value;
  const decimals =
    typeof value === "string" ? (value.split(".")[1]?.length ?? 0) : 0;
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 1),
  });
}

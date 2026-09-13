export function formatRelativeTime(
  iso: string,
  options: { suffix?: boolean; longNow?: boolean; dateAfterWeek?: boolean } = {},
): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  let value: string;
  if (minutes < 1) value = options.longNow ? "just now" : "now";
  else if (minutes < 60) value = `${minutes}m`;
  else {
    const hours = Math.floor(minutes / 60);
    if (hours < 24) value = `${hours}h`;
    else {
      const days = Math.floor(hours / 24);
      if (days < 7) value = `${days}d`;
      else if (options.dateAfterWeek) return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      else value = `${Math.floor(days / 7)}w`;
    }
  }
  return options.suffix && value !== "now" && value !== "just now" ? `${value} ago` : value;
}

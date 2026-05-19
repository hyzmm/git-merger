/** Convert unix seconds to a human-friendly relative time. */
export function timeAgo(unixSec: number, now = Date.now() / 1000): string {
  const d = Math.max(0, now - unixSec);
  if (d < 45) return "just now";
  if (d < 90) return "a minute ago";
  if (d < 60 * 45) return `${Math.round(d / 60)} minutes ago`;
  if (d < 60 * 90) return "an hour ago";
  if (d < 60 * 60 * 22) return `${Math.round(d / 3600)} hours ago`;
  if (d < 60 * 60 * 36) return "yesterday";
  if (d < 60 * 60 * 24 * 25) return `${Math.round(d / 86400)} days ago`;
  if (d < 60 * 60 * 24 * 45) return "a month ago";
  if (d < 60 * 60 * 24 * 320) return `${Math.round(d / (86400 * 30))} months ago`;
  if (d < 60 * 60 * 24 * 547) return "a year ago";
  return `${Math.round(d / (86400 * 365))} years ago`;
}

/** Full date: 2026-05-19 17:55:11 +08:00 */
export function fullDate(unixSec: number): string {
  const date = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const tzh = pad(Math.floor(Math.abs(tz) / 60));
  const tzm = pad(Math.abs(tz) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `${sign}${tzh}:${tzm}`
  );
}

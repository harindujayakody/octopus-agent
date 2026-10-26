import { FLAG_URLS } from "./flags";

/// Flat rectangular country flag; empty or unknown input renders nothing. Its
/// file comes from the URL map as an inline background, drawn the way the
/// flag-icons stylesheet drew it (contain, centred, no repeat), so a flag
/// looks as it did before that stylesheet left (PERF-16).
export function CountryFlag({ cc, height = 17 }: { cc: string; height?: number }) {
  if (!cc || cc.length !== 2 || !/^[a-zA-Z]{2}$/.test(cc)) return null;
  const code = cc.toLowerCase();
  const url = FLAG_URLS[code];
  if (!url) return null;
  return (
    <span
      data-flag={code}
      className="rounded-chip-sm outline outline-1 -outline-offset-1 outline-stroke-image flex-none inline-block bg-contain bg-center bg-no-repeat"
      style={{ height, width: Math.round(height * 4 / 3), backgroundImage: `url("${url}")` }}
      aria-hidden
    />
  );
}

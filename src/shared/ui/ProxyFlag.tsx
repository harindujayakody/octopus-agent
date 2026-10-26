import { GlobeIcon } from "../icons";
import { CountryFlag } from "./CountryFlag";
import { FLAG_URLS } from "./flags";

/// A proxy's flag, or a neutral globe in the flag's own slot when it has none
/// (no country, or a code with no flag file), so the names after it line up
/// down a list and a picker (owner item 11). The slot is the flag's box (4:3
/// of `height`); the globe in it is the usual 14 px icon, the soft gray at rest
/// and the sub gray on a highlighted option row (3:1 on both).
export function ProxyFlag({ cc, height = 17 }: { cc?: string | null; height?: number }) {
  if (cc && /^[a-zA-Z]{2}$/.test(cc) && FLAG_URLS[cc.toLowerCase()]) return <CountryFlag cc={cc} height={height} />;
  return (
    <span
      data-flag-fallback
      className="inline-flex flex-none items-center justify-center text-icon-soft-400 group-data-highlighted:text-icon-sub-600"
      style={{ height, width: Math.round(height * 4 / 3) }}
      aria-hidden
    >
      <GlobeIcon className="size-3.5" />
    </span>
  );
}

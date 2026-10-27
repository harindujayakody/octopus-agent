import {
  siAirbnb, siAliexpress, siApple, siBinance, siBluesky, siBrave, siCoinbase, siDiscord, siEbay, siEtsy, siFacebook,
  siFirefoxbrowser, siGithub, siGmail, siGoogle, siGooglechrome, siInstagram, siKick, siKucoin, siMedium,
  siNetflix, siOnlyfans, siPaypal, siPinterest, siQuora, siReddit, siShopify, siSnapchat, siSpotify,
  siTelegram, siThreads, siTiktok, siTinder, siTwitch, siUber, siVk, siWhatsapp, siX, siYoutube,
  type SimpleIcon,
} from "simple-icons";
import { OctopusLogo } from "../icons";
/** The browsers a profile can start in (entities/profile `EngineId`). */
type EngineId = "shardx" | "chrome" | "chromium" | "firefox" | "brave" | "thorium" | "helium";

/// Brand marks from Simple Icons (CC0): the sites a profile is for, picked in
/// its editor to tell it apart in the list, and the browsers it starts in.
/// Each is one SVG path drawn in its brand color; a brand whose color is
/// black or white takes the text color, so it reads in both themes.

/** A site a profile can carry as its icon, by the id stored in `_meta.icon`. */
export type SiteIcon = { id: string; title: string; hex: string; path: string };

const site = (id: string, i: SimpleIcon): SiteIcon => ({ id, title: i.title, hex: i.hex, path: i.path });

/** The sites offered, grouped loosely: social, messaging, shopping, money, the rest. */
export const SITE_ICONS: readonly SiteIcon[] = [
  site("facebook", siFacebook),
  site("instagram", siInstagram),
  site("x", siX),
  site("tiktok", siTiktok),
  site("youtube", siYoutube),
  site("pinterest", siPinterest),
  site("reddit", siReddit),
  site("snapchat", siSnapchat),
  site("threads", siThreads),
  site("bluesky", siBluesky),
  site("vk", siVk),
  site("quora", siQuora),
  site("medium", siMedium),
  site("tinder", siTinder),
  site("onlyfans", siOnlyfans),
  site("twitch", siTwitch),
  site("kick", siKick),
  site("discord", siDiscord),
  site("telegram", siTelegram),
  site("whatsapp", siWhatsapp),
  site("google", siGoogle),
  site("gmail", siGmail),
  site("apple", siApple),
  site("github", siGithub),
  site("ebay", siEbay),
  site("etsy", siEtsy),
  site("shopify", siShopify),
  site("aliexpress", siAliexpress),
  site("airbnb", siAirbnb),
  site("uber", siUber),
  site("paypal", siPaypal),
  site("binance", siBinance),
  site("coinbase", siCoinbase),
  site("kucoin", siKucoin),
  site("spotify", siSpotify),
  site("netflix", siNetflix),
];

const BY_ID = new Map(SITE_ICONS.map((s) => [s.id, s]));

/** The site an id names, or undefined for none or one no longer offered. */
export const siteIcon = (id: string | null | undefined): SiteIcon | undefined => (id ? BY_ID.get(id) : undefined);

/** Near-black or near-white brands draw in the text color, so they show on either theme. */
function fillOf(hex: string): string {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l < 0.12 || l > 0.92 ? "currentColor" : `#${hex}`;
}

/** One brand mark, `size` px square. Decoration: the name beside it says what it is. */
export function BrandMark({ path, hex, size = 14, className }: { path: string; hex: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className ?? "shrink-0"}
      fill={fillOf(hex)}
    >
      <path d={path} />
    </svg>
  );
}

/** A profile's site icon; nothing when it has none. */
export function ProfileIcon({ id, size = 14 }: { id: string | null | undefined; size?: number }) {
  const s = siteIcon(id);
  return s ? <span data-profile-icon={s.id} className="inline-flex shrink-0"><BrandMark path={s.path} hex={s.hex} size={size} /></span> : null;
}

/** Chromium's mark: Chrome's shape in Chromium's blue (Simple Icons has no Chromium). */
const CHROMIUM_HEX = "4587F3";

/** A browser Simple Icons has no mark for: its initial on a disc of its color. */
function LetterMark({ letter, hex, size }: { letter: string; hex: string; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="12" cy="12" r="12" fill={`#${hex}`} />
      <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{letter}</text>
    </svg>
  );
}

/** The logo of the browser a profile starts in. */
export function EngineIcon({ engine, size = 14 }: { engine: EngineId; size?: number }) {
  const mark =
    engine === "chrome" ? <BrandMark path={siGooglechrome.path} hex={siGooglechrome.hex} size={size} />
    : engine === "chromium" ? <BrandMark path={siGooglechrome.path} hex={CHROMIUM_HEX} size={size} />
    : engine === "firefox" ? <BrandMark path={siFirefoxbrowser.path} hex={siFirefoxbrowser.hex} size={size} />
    : engine === "brave" ? <BrandMark path={siBrave.path} hex={siBrave.hex} size={size} />
    : engine === "thorium" ? <LetterMark letter="T" hex="1E6FD9" size={size} />
    : engine === "helium" ? <LetterMark letter="H" hex="111827" size={size} />
    : <OctopusLogo size={size} />;
  return <span data-engine-icon={engine} className="inline-flex shrink-0">{mark}</span>;
}

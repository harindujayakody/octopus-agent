import { AUTO_LANG, AUTO_TZ } from "../constants";
import { intlLocale, type Lang } from "../i18n";

/// Where a hand-set timezone or language places a browser, so the Location
/// leak card can say that it does not match the proxy's country (the owner's
/// overview redesign, 2026-10-01). Small on purpose: the zones the Timezone
/// menu offers and the common ones people type, nothing more. A zone or a
/// language this does not know is not judged, so a gap never flags anyone.

/** IANA zone to ISO country. UTC and Etc zones are no country. */
const ZONE_COUNTRY: Record<string, string> = {
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US",
  "America/Phoenix": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US", "America/Detroit": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Mexico_City": "MX", "America/Sao_Paulo": "BR",
  "America/Argentina/Buenos_Aires": "AR", "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Lisbon": "PT", "Europe/Madrid": "ES", "Europe/Paris": "FR",
  "Europe/Brussels": "BE", "Europe/Amsterdam": "NL", "Europe/Berlin": "DE", "Europe/Zurich": "CH", "Europe/Vienna": "AT",
  "Europe/Rome": "IT", "Europe/Prague": "CZ", "Europe/Warsaw": "PL", "Europe/Budapest": "HU", "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Bucharest": "RO", "Europe/Athens": "GR",
  "Europe/Istanbul": "TR", "Europe/Kyiv": "UA", "Europe/Kiev": "UA", "Europe/Moscow": "RU",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Jerusalem": "IL", "Asia/Karachi": "PK", "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Jakarta": "ID", "Asia/Kuala_Lumpur": "MY",
  "Asia/Singapore": "SG", "Asia/Manila": "PH", "Asia/Hong_Kong": "HK", "Asia/Shanghai": "CN", "Asia/Taipei": "TW",
  "Asia/Seoul": "KR", "Asia/Tokyo": "JP", "Australia/Perth": "AU", "Australia/Brisbane": "AU", "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU", "Pacific/Auckland": "NZ", "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Johannesburg": "ZA",
};

/** The country a hand-set timezone places the browser in; null for Auto, UTC or a zone this map does not know. */
export function zoneCountry(tz: string): string | null {
  if (!tz || tz === AUTO_TZ) return null;
  return ZONE_COUNTRY[tz] ?? null;
}

/** The country a hand-set language names ("de-DE" is DE); null for Auto or a language with no region. */
export function localeCountry(code: string): string | null {
  if (!code || code === AUTO_LANG) return null;
  const region = code.split(/[-_]/)[1];
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
}

/// English adjectives for "US time on German IP" (the approved copy). A
/// country not here reads by its name ("Brazil IP"), as Chinese and Russian
/// always do.
const ADJECTIVE_EN: Record<string, string> = {
  US: "US", GB: "UK", IE: "Irish", PT: "Portuguese", ES: "Spanish", FR: "French", BE: "Belgian", NL: "Dutch",
  DE: "German", CH: "Swiss", AT: "Austrian", IT: "Italian", CZ: "Czech", PL: "Polish", HU: "Hungarian",
  SE: "Swedish", NO: "Norwegian", DK: "Danish", FI: "Finnish", RO: "Romanian", GR: "Greek", TR: "Turkish",
  UA: "Ukrainian", RU: "Russian", CA: "Canadian", MX: "Mexican", BR: "Brazilian", AR: "Argentine",
  CO: "Colombian", PE: "Peruvian", CL: "Chilean", AE: "UAE", SA: "Saudi", IL: "Israeli", PK: "Pakistani",
  IN: "Indian", TH: "Thai", VN: "Vietnamese", ID: "Indonesian", MY: "Malaysian", SG: "Singapore",
  PH: "Philippine", HK: "Hong Kong", CN: "Chinese", TW: "Taiwanese", KR: "Korean", JP: "Japanese",
  AU: "Australian", NZ: "New Zealand", EG: "Egyptian", NG: "Nigerian", ZA: "South African",
};

const regionNames = new Map<string, Intl.DisplayNames | null>();

/** A country as the leak line names it: "German" in English, "德国" in
 *  Chinese, "Германия" in Russian. */
export function countryWord(cc: string, lang: Lang): string {
  const code = cc.toUpperCase();
  if (lang === "en" && ADJECTIVE_EN[code]) return ADJECTIVE_EN[code];
  const locale = intlLocale(lang);
  if (!regionNames.has(locale)) {
    try { regionNames.set(locale, new Intl.DisplayNames([locale], { type: "region" })); } catch { regionNames.set(locale, null); }
  }
  try { return regionNames.get(locale)?.of(code) ?? code; } catch { return code; }
}

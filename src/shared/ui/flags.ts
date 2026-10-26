/// Country flag files by lowercase code: URLs only. A flag's file loads when a
/// flag is shown, and no stylesheet carries 271 flags any more (PERF-16).
/// Two-letter codes only (`??.svg`): `CountryFlag` never asks for the longer
/// names (gb-eng, es-ct, arab...), so they are not bundled.
/// `exhaustive`, because a glob skips node_modules otherwise.
const FILES = import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/??.svg", {
  query: "?url", import: "default", eager: true, exhaustive: true,
});

export const FLAG_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), url]),
);

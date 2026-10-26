// The app's fonts, bundled so the UI looks the same offline (spec).
// Inter is the official InterVariable.woff2 (Inter 4.1, OFL; TYPE-04): it has
// the opsz axis, the OpenType features and the arrows and key symbols the UI
// prints (→ ⌘ ✓), which the Google Fonts subset lacked. Its @font-face is in
// styles/index.css. Both files are preloaded (PERF-17) so the first frame
// draws in the real fonts instead of reflowing when they land.
import "@fontsource-variable/jetbrains-mono";
import interUrl from "./fonts/InterVariable.woff2?url";
import monoUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";

for (const href of [interUrl, monoUrl]) {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  // Fonts load in CORS mode; a preload without it would be fetched twice.
  link.crossOrigin = "anonymous";
  link.href = href;
  document.head.appendChild(link);
}

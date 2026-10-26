// Bundled, so the app looks the same offline and on machines without them.
import "./fonts";
import React, { type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@proxyshard/shardx-ui-kit";
import "./styles/index.css";
import "./styles/app.css";
import { KitLabels } from "./KitLabels";
import { loadLang, useLang } from "../shared/i18n";
import { applyStoredMotion } from "../shared/model/motion";
import { applyStoredInterfaceSize } from "../shared/model/interfaceSize";
import { installWindowGuards } from "./guards";
import { installPinScrollFocus } from "../shared/lib/pinScrollFocus";
import { installScrollActivity } from "../shared/lib/scrollActivity";
import { NativeThemeSync } from "./nativeTheme";
import { askEngineEarly } from "../widgets/FirstRunGate/engineEarly";
import { showWindowWhenPainted } from "./showWindow";

// The always-on-top panels are second Tauri windows on this same bundle,
// addressed by hash — a 60px strip needs no vite entry of its own.
const panelParams = new URLSearchParams(
  window.location.hash.replace(/^#\/?/, ""),
);
const panelGroup = panelParams.get("syncPanel");
const helperProfile = panelParams.get("helperPanel");
const fleet = panelParams.get("fleet");

// The launcher only: its engine gate asks while React draws its first frame.
if (!panelGroup && !helperProfile && !fleet) askEngineEarly();
// The launcher only: its window opens hidden and shows once it has painted a
// screen (the panels are windows of their own, shown by the backend).
if (!panelGroup && !helperProfile && !fleet) showWindowWhenPainted();

applyStoredMotion();
// The launcher window only: the floating panels are fixed-size strips.
if (!panelGroup && !helperProfile && !fleet) applyStoredInterfaceSize();
installWindowGuards();
installPinScrollFocus();
installScrollActivity();

type Screen = (lang: string) => ReactElement;

/// The always-on-top panels are second windows on this same page, addressed
/// by hash (the backend opens `index.html#/?fleet=1`). Each window loads only
/// what it draws: a panel never fetches the launcher's code (PERF-23, PERF-24).
async function loadScreen(): Promise<Screen> {
  if (panelGroup) {
    const { SyncPanel } = await import("../widgets/SyncPanel");
    return (lang) => <SyncPanel key={lang} group={panelGroup} />;
  }
  if (helperProfile) {
    const { HelperPanel } = await import("../widgets/HelperPanel");
    return (lang) => <HelperPanel key={lang} profile={helperProfile} />;
  }
  if (fleet) {
    const { FleetMonitor } = await import("../widgets/FleetMonitor");
    return (lang) => <FleetMonitor key={lang} />;
  }
  // A Delete all data that did not finish opens the launcher on its own
  // screen, before the app reads any data (reset.rs journal).
  const [{ App }, { ResetPendingGate }] = await Promise.all([import("./App"), import("../features/delete-all-data")]);
  return (lang) => <ResetPendingGate><App key={lang} /></ResetPendingGate>;
}

// Most strings are translated as their element is created rather than by a
// component that watches the language, so switching it has to build the tree
// again. Keying on the language is what does that.
function Root({ screen }: { screen: Screen }) {
  const lang = useLang((s) => s.lang);
  return (
    <ThemeProvider>
      <NativeThemeSync />
      <KitLabels>{screen(lang)}</KitLabels>
    </ThemeProvider>
  );
}

// The stored language's words (English is built in, i18n) and the window's
// screen load together, so the first frame already speaks the stored
// language. If another language's words cannot load, it draws in English
// rather than not at all.
void Promise.all([loadLang(useLang.getState().lang).catch(() => {}), loadScreen()]).then(([, screen]) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root screen={screen} />
    </React.StrictMode>,
  );
});

// index.html set color-scheme inline before the stylesheet loaded; from here
// the stylesheet sets it from data-theme, which a theme change also updates.
document.documentElement.style.removeProperty("color-scheme");

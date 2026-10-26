import type { TourStep } from "../model/types";

/// The full tour (onboarding spec 5.1): eighteen steps across every page, in
/// the order a first-time user needs them. `target` is the `data-tour` key of
/// the element a step points at; a step whose element is not on screen (no
/// profiles, nothing to fix, no project open) shows its card in the middle,
/// with its picture. Only steps whose element is always there have none,
/// and step 16, whose text is true without the Buy traffic button (an
/// account with no key yet has none). No text says "here" about a part that
/// may be missing. `title` and `body` are translation keys, written out in
/// full so that check-i18n sees each one as used.
///
/// Steps 1 to 9 are Profiles, so a page's "Show me around" on Profiles plays
/// the first nine. Step 17 points at the Settings Save bar while it shows and
/// at the page title (which carries the same key) while it does not; its text
/// says what the bar is either way. Step 18 points at the Trash page's title,
/// beside which the (i) is: no step points at the (i) itself, a ring round a
/// button that small reads badly. A step that is on another page than the one
/// before it opens with a beat on that page's item in the sidebar (the engine's,
/// not a step of its own).
export const fullTour: TourStep[] = [
  { id: "sidebar", section: "profiles", target: "sidebar", title: "tour.full.sidebar.title", body: "tour.full.sidebar.body" },
  { id: "search", section: "profiles", target: "search", title: "tour.full.search.title", body: "tour.full.search.body" },
  { id: "list", section: "profiles", target: "profiles-list", title: "tour.full.list.title", body: "tour.full.list.body", picture: "profileList" },
  { id: "newProfile", section: "profiles", target: "new-profile", title: "tour.full.newProfile.title", body: "tour.full.newProfile.body" },
  { id: "start", section: "profiles", target: "start", title: "tour.full.start.title", body: "tour.full.start.body", picture: "startButton" },
  { id: "panel", section: "profiles", target: "details-panel", title: "tour.full.panel.title", body: "tour.full.panel.body", picture: "panel" },
  { id: "listTools", section: "profiles", target: "list-tools", title: "tour.full.listTools.title", body: "tour.full.listTools.body", picture: "filters" },
  { id: "viewsFolders", section: "profiles", target: "views-folders", title: "tour.full.viewsFolders.title", body: "tour.full.viewsFolders.body" },
  { id: "proxies", section: "proxies", target: "add-proxy", title: "tour.full.proxies.title", body: "tour.full.proxies.body" },
  { id: "fingerprints", section: "fingerprints", target: "fingerprints", title: "tour.full.fingerprints.title", body: "tour.full.fingerprints.body" },
  { id: "extensions", section: "extensions", target: "add-extension", title: "tour.full.extensions.title", body: "tour.full.extensions.body" },
  { id: "bookmarks", section: "bookmarks", target: "new-bookmark", title: "tour.full.bookmarks.title", body: "tour.full.bookmarks.body" },
  { id: "automation", section: "automation", target: "new-project", title: "tour.full.automation.title", body: "tour.full.automation.body" },
  { id: "editor", section: "automation", target: "editor-save-run", title: "tour.full.editor.title", body: "tour.full.editor.body", picture: "automationEditor" },
  { id: "settings", section: "settings", settingsTab: "general", target: "settings-save", title: "tour.full.settings.title", body: "tour.full.settings.body" },
  { id: "help", section: "trash", target: "page-title", title: "tour.full.help.title", body: "tour.full.help.body" },
];

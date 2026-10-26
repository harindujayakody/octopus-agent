import type { Section } from "../../../shared/types";
import type { TourStep } from "../model/types";

/// A page's tip (onboarding spec 6): two or three steps that play on the
/// first visit, in the order a person needs them. They point at the same
/// `data-tour` elements as the full tour: the page's main control, and the
/// page's title (`page-title`), beside which the (i) is, which every page has:
/// no step points at the (i) itself, a ring round a button that small reads
/// badly. Trash has no control of its own to point at, so its first step
/// points at its title too. A step
/// whose element is not on screen (no project open) shows
/// its card in the middle, with its picture where it has one. `title` and
/// `body` are translation keys, written out in full so that check-i18n sees
/// each one as used. The Settings steps name no tab: a tip never moves the
/// person to another one. Profiles has none: its part is the start of the full tour.
export const pageTips: Partial<Record<Section, TourStep[]>> = {
  proxies: [
    { id: "proxiesAdd", section: "proxies", target: "add-proxy", title: "tour.tips.proxies.add.title", body: "tour.tips.proxies.add.body" },
    { id: "proxiesHelp", section: "proxies", target: "page-title", title: "tour.tips.proxies.help.title", body: "tour.tips.proxies.help.body" },
  ],
  fingerprints: [
    { id: "fingerprintsLibrary", section: "fingerprints", target: "fingerprints", title: "tour.tips.fingerprints.library.title", body: "tour.tips.fingerprints.library.body" },
    { id: "fingerprintsHelp", section: "fingerprints", target: "page-title", title: "tour.tips.fingerprints.help.title", body: "tour.tips.fingerprints.help.body" },
  ],
  extensions: [
    { id: "extensionsAdd", section: "extensions", target: "add-extension", title: "tour.tips.extensions.add.title", body: "tour.tips.extensions.add.body" },
    { id: "extensionsHelp", section: "extensions", target: "page-title", title: "tour.tips.extensions.help.title", body: "tour.tips.extensions.help.body" },
  ],
  bookmarks: [
    { id: "bookmarksAdd", section: "bookmarks", target: "new-bookmark", title: "tour.tips.bookmarks.add.title", body: "tour.tips.bookmarks.add.body" },
    { id: "bookmarksHelp", section: "bookmarks", target: "page-title", title: "tour.tips.bookmarks.help.title", body: "tour.tips.bookmarks.help.body" },
  ],
  automation: [
    { id: "automationProject", section: "automation", target: "new-project", title: "tour.tips.automation.project.title", body: "tour.tips.automation.project.body" },
    { id: "automationEditor", section: "automation", target: "editor-save-run", title: "tour.tips.automation.editor.title", body: "tour.tips.automation.editor.body", picture: "automationEditor" },
    { id: "automationHelp", section: "automation", target: "page-title", title: "tour.tips.automation.help.title", body: "tour.tips.automation.help.body" },
  ],
  settings: [
    { id: "settingsSave", section: "settings", target: "settings-save", title: "tour.tips.settings.save.title", body: "tour.tips.settings.save.body" },
    { id: "settingsHelp", section: "settings", target: "page-title", title: "tour.tips.settings.help.title", body: "tour.tips.settings.help.body" },
  ],
  trash: [
    { id: "trashPage", section: "trash", target: "trash-title", title: "tour.tips.trash.page.title", body: "tour.tips.trash.page.body" },
    { id: "trashHelp", section: "trash", target: "page-title", title: "tour.tips.trash.help.title", body: "tour.tips.trash.help.body" },
  ],
};

import type { T } from "../../../shared/i18n";
import type { Grant } from "../../../entities/extension";

/** Every site: each grant says it in its own sentence (Chinese takes no space before it). */
const ALL = new Set(["<all_urls>", "*://*/*"]);

/** The common browser features in words, the risky ones first; each key called literally. */
function permissionWords(t: T, v: string): string {
  switch (v) {
    case "debugger": return t("extensions.permDebugger");
    case "cookies": return t("extensions.permCookies");
    case "proxy": return t("extensions.permProxy");
    case "webRequest": case "webRequestBlocking": return t("extensions.permWebRequest");
    case "declarativeNetRequest": return t("extensions.permNetRules");
    case "nativeMessaging": return t("extensions.permNative");
    case "management": return t("extensions.permManagement");
    case "history": return t("extensions.permHistory");
    case "tabs": return t("extensions.permTabs");
    case "scripting": return t("extensions.permScripting");
    case "browsingData": return t("extensions.permBrowsingData");
    case "privacy": return t("extensions.permPrivacy");
    case "downloads": return t("extensions.permDownloads");
    case "clipboardRead": return t("extensions.permClipboard");
    case "geolocation": return t("extensions.permLocation");
    default: return t("extensions.grantPermission", { value: v });
  }
}

/** A page or setting an extension takes over (manifest_edit.rs OVERRIDES); each key called literally. */
function overrideWords(t: T, v: string): string {
  switch (v) {
    case "chrome_settings_overrides.search_provider": return t("extensions.overrideSearch");
    case "chrome_settings_overrides.homepage": return t("extensions.overrideHomepage");
    case "chrome_settings_overrides.startup_pages": return t("extensions.overrideStartup");
    case "chrome_url_overrides.newtab": return t("extensions.overrideNewTab");
    case "chrome_url_overrides.bookmarks": return t("extensions.overrideBookmarks");
    case "chrome_url_overrides.history": return t("extensions.overrideHistory");
    case "devtools_page": return t("extensions.overrideDevtools");
    case "omnibox": return t("extensions.overrideOmnibox");
    default: return v;
  }
}

/** What a new version may do that the installed one could not, in one line. */
export function grantWords(t: T, g: Grant): string {
  switch (g.kind) {
    case "permission": return permissionWords(t, g.value);
    case "host": return ALL.has(g.value) ? t("extensions.grantHostAll") : t("extensions.grantHost", { value: g.value });
    case "script_host": return ALL.has(g.value) ? t("extensions.grantScriptHostAll") : t("extensions.grantScriptHost", { value: g.value });
    case "main_world": return ALL.has(g.value) ? t("extensions.grantMainWorldAll") : t("extensions.grantMainWorld", { value: g.value });
    case "connectable": {
      // `extension:<id>`: another extension; `extension:*` any of them.
      if (ALL.has(g.value)) return t("extensions.grantConnectableAll");
      if (!g.value.startsWith("extension:")) return t("extensions.grantConnectable", { value: g.value });
      const id = g.value.slice("extension:".length);
      return id === "*" ? t("extensions.grantAnyExtension") : t("extensions.grantConnectableExtension", { value: id });
    }
    case "web_resource": return ALL.has(g.value) ? t("extensions.grantWebResourceAll") : t("extensions.grantWebResource", { value: g.value });
    case "manifest_version": return t("extensions.grantManifestVersion", { value: g.value });
    case "override": return overrideWords(t, g.value);
    default: return g.value;
  }
}

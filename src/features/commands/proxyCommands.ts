import { t } from "../../shared/i18n";
import { AddIcon, CopyIcon, DeleteIcon, DownloadIcon, PeekIcon, RefreshIcon, SyncIcon } from "../../shared/icons";
import { clip } from "../../shared/lib/clipboard";
import { toast } from "../../shared/model/toast";
import { useNav } from "../../shared/model/navigation";
import { defineCommands, type Command } from "../../shared/commands";
import { useProxy } from "../../entities/proxy";
import { useProfileUi } from "../../entities/profile";
import { onProxy, teamRefusal } from "../../entities/space";

const store = () => useProxy.getState();
const byId = (id: string) => store().proxies.find((p) => p.id === id);
const LIST = { area: "proxies", page: "proxies" } as const;

/** Why a team's rules let none of these proxies be acted on, or null when one may be. */
const noneMay = (ids: string[], action: "delete" | "take_out"): string | null => {
  let first: string | null = null;
  for (const id of ids) {
    const r = teamRefusal(action, onProxy(id));
    if (r === null) return null;
    first ??= r;
  }
  return first;
};

/// Assign and Export act on their subject and leave the selection exactly as
/// it was: a palette run on the active proxy selects nothing, and a selected
/// proxy a filter hides stays selected (owner rule, ORDER R26 a; Pair 37
/// review, M3).

export const PROXY_COMMANDS: readonly Command[] = [
  {
    ...LIST, id: "proxy.openPeek", scope: "active", group: "open", icon: PeekIcon,
    focusAfter: true,
    label: () => t("commands.openPeek"), keys: ["Enter", "Space"], keysJoin: "or",
    surfaces: ["rowMenu", "hover", "sheet"],
    run: (s, { from }) => (from === "keys" ? store().togglePeek(s.ids[0]) : store().openPeek(s.ids[0])),
  },
  {
    ...LIST, id: "proxy.test", scope: "selection", group: "run", icon: RefreshIcon,
    label: () => t("commands.test"), keys: ["T"],
    surfaces: ["rowMenu", "bulkBar", "palette", "sheet"],
    run: async (s, { from }) => {
      // The row's own Test is quiet (the row shows its result); everywhere
      // else a Test reports, for one proxy too (LQ-01/02; Pair 37 review, M1).
      const one = (from === "rowMenu" || from === "hover") && s.ids.length === 1 ? byId(s.ids[0]) : undefined;
      if (one) await store().testProxy(one);
      else await store().bulkTest(s.ids);
    },
  },
  {
    ...LIST, id: "proxy.copyAddress", scope: "active", group: "copy", icon: CopyIcon,
    label: () => t("commands.copyAddress"),
    surfaces: ["rowMenu", "hover", "peekMenu"],
    run: (s) => {
      const p = byId(s.ids[0]);
      if (!p) return;
      return clip.write(`${p.host}:${p.port}`)
        .then(() => { toast.ok(t("proxyList.addressCopied")); })
        .catch((e) => { toast.fail({ title: t("commands.copyFailed"), detail: e }); });
    },
  },
  {
    ...LIST, id: "proxy.assign", scope: "selection", group: "organize", icon: SyncIcon,
    focusAfter: true,
    label: () => t("commands.assignToProfiles"),
    surfaces: ["bulkBar", "palette"],
    // The one Assign dialog, opened on these proxies (in the list's order);
    // it asks which profiles (IFACE-03, F12).
    run: (s) => useProfileUi.getState().openAssignFrom({ kind: "proxies", proxyIds: s.ids }),
  },
  {
    ...LIST, id: "proxy.export", scope: "selection", group: "copy", icon: CopyIcon,
    label: () => t("commands.export"),
    surfaces: ["bulkBar", "palette"],
    // Its lines carry its login out of the team: Take out.
    disabled: (s) => noneMay(s.ids, "take_out"),
    run: (s) => store().bulkExport(s.ids),
  },
  {
    ...LIST, id: "proxy.delete", scope: "selection", group: "danger", icon: DeleteIcon, danger: true,
    focusAfter: true,
    label: () => t("commands.delete"), keys: ["Delete", "Backspace"], keysJoin: "or",
    // Not Test in Peek's menu: its header's Test now is the same act, and
    // saves Peek's edits first (F12a).
    surfaces: ["rowMenu", "hover", "bulkBar", "palette", "sheet", "peekMenu"],
    disabled: (s) => noneMay(s.ids, "delete"),
    // Behind an Undo toast (ruling 18): deleted proxies leave the selection,
    // and Undo or a failure puts them back in it (A Tasks 9 and 14).
    run: (s) => (s.ids.length === 1 ? store().removeProxy(s.ids[0]) : store().bulkDelete(s.ids)),
  },
  {
    ...LIST, id: "proxy.select", scope: "active", group: "select",
    label: () => t("commands.select"), keys: ["X"],
    surfaces: ["sheet"],
    run: (s) => store().toggleSelect(s.ids[0]),
  },
  {
    ...LIST, id: "proxy.selectAll", scope: "page", group: "select",
    label: () => t("commands.selectAll"), keys: ["Mod+A"],
    surfaces: ["sheet"],
    run: () => store().selectAll(),
  },
  {
    ...LIST, id: "proxy.closePeek", scope: "page", group: "select",
    label: () => t("commands.closePeek"), keys: ["Escape"], keyOwner: "self",
    surfaces: ["sheet"],
  },
  {
    ...LIST, id: "proxy.clearSelection", scope: "page", group: "select",
    label: () => t("commands.clearSelection"), keys: ["Escape"], keyOwner: "self",
    surfaces: ["bulkBar", "sheet"],
    run: () => store().clearSelected(),
  },
  {
    ...LIST, id: "proxy.moveThrough", scope: "page", group: "move",
    label: () => t("commands.moveThroughList"), keys: ["ArrowUp", "ArrowDown"], keyOwner: "self",
    surfaces: ["sheet"],
  },
  {
    ...LIST, id: "proxy.firstLast", scope: "page", group: "move",
    label: () => t("commands.firstLast"), keys: ["Home", "End"], keysJoin: "or", keyOwner: "self",
    surfaces: ["sheet"],
  },
  {
    // The Proxies header's primary prints these words (one name per
    // command). "Add proxies" since Phase F Task 3 (one pasted line or
    // many); "new proxy" still finds it.
    ...LIST, id: "proxy.new", scope: "page", group: "create", icon: AddIcon,
    focusAfter: true,
    // C is each page's New (IFACE-11): Add proxies here, as New profile on Profiles.
    label: () => t("commands.addProxies"), keys: ["C"], keyWhere: "page", singleKey: true,
    keywords: () => ["new proxy"],
    surfaces: ["palette", "sheet"],
    // A team's proxies are made with Create in the team.
    disabled: () => teamRefusal("create"),
    run: async () => { if (await useNav.getState().setSection("proxies")) store().setBulkOpen(true); },
  },
  {
    ...LIST, id: "proxy.import", scope: "page", group: "create", icon: DownloadIcon,
    label: () => t("commands.importProxies"),
    surfaces: ["pageMenu", "palette"],
    disabled: () => teamRefusal("create"),
    run: () => store().bulkImportClipboard(),
  },
];

defineCommands(PROXY_COMMANDS);

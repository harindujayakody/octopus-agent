import { t } from "../../shared/i18n";
import { DeleteIcon, RestoreIcon } from "../../shared/icons";
import { useNav } from "../../shared/model/navigation";
import { defineCommands, type Command, type Subject } from "../../shared/commands";
import { useTrash, type TrashEntry } from "../../entities/trash";
import { inTeam } from "../../entities/space";

const store = () => useTrash.getState();
const entriesOf = (s: Subject): TrashEntry[] => {
  const byId = new Map(store().items.map((e) => [e.id, e]));
  return s.ids.flatMap((id) => byId.get(id) ?? []);
};
const LIST = { area: "trash", page: "trash" } as const;

/// The Trash's commands (E10, F25b). Restore and Delete for good act on the
/// page's selection, else on one row (its menu); an entry that leaves the
/// Trash leaves the selection, and one that failed stays picked (owner rule).
export const TRASH_COMMANDS: readonly Command[] = [
  {
    ...LIST, id: "trash.restore", scope: "selection", group: "organize", icon: RestoreIcon,
    label: (n) => (n > 1 ? t("trash.restoreCount", { n }) : t("trash.restore")),
    // The personal Trash's; the team's acts on its own rows (pages/trash/team.tsx).
    when: () => !inTeam(),
    surfaces: ["rowMenu", "bulkBar", "palette"],
    run: (s) => store().restoreMany(entriesOf(s)),
  },
  {
    // It asks first, naming how many (CRAFT-03). The list's Delete key runs
    // the same (DataList owns the key).
    ...LIST, id: "trash.deleteForGood", scope: "selection", group: "danger", icon: DeleteIcon, danger: true,
    focusAfter: true,
    label: () => t("trash.deleteForGood"), keys: ["Delete", "Backspace"], keysJoin: "or", keyOwner: "self",
    when: () => !inTeam(),
    surfaces: ["rowMenu", "bulkMore", "palette", "sheet"],
    run: (s) => store().purgeMany(entriesOf(s)),
  },
  {
    ...LIST, id: "trash.empty", scope: "page", group: "danger", icon: DeleteIcon, danger: true,
    focusAfter: true,
    label: () => t("commands.emptyTrash"),
    // The team's Trash has no Empty: its server keeps it.
    when: () => !inTeam(),
    surfaces: ["pageMenu", "palette"],
    // Nothing to empty: it says so instead of doing nothing (Pair 44 review,
    // I2). Before the Trash has loaded it can run: the Trash opens, loads and
    // asks (the palette reads the Trash as it opens).
    disabled: () => (store().status === "ready" && store().items.length === 0 ? t("commands.trashIsEmpty") : null),
    // It asks first (useTrash.empty); from another page the Trash opens and loads first.
    run: async () => {
      if (!(await useNav.getState().setSection("trash"))) return;
      await store().init();
      await store().empty();
    },
  },
];

defineCommands(TRASH_COMMANDS);

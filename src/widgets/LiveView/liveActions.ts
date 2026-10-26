import type { Picked } from "../../entities/automation";

export type MenuAction = { kind: string; label: string; needsText?: boolean };

/** What a right-click offers for the element under it. Ordered by how often an
 *  operator wants each. */
export const liveActions = (t: (key: string) => string): MenuAction[] => [
  { kind: "click", label: t("actionMenu.click") },
  { kind: "type", label: t("actionMenu.type"), needsText: true },
  { kind: "doubleClick", label: t("actionMenu.doubleClick") },
  { kind: "rightClick", label: t("actionMenu.rightClick") },
  { kind: "hover", label: t("actionMenu.hover") },
  { kind: "clear", label: t("actionMenu.clear") },
  { kind: "waitFor", label: t("actionMenu.waitFor") },
  { kind: "ifExists", label: t("actionMenu.ifExists") },
  { kind: "readText", label: t("actionMenu.readText"), needsText: true },
];

/** The menu's heading: which element (or point) the chosen action will target. */
export function describeTarget(target: Picked | null, t: (key: string, vars?: Record<string, string>) => string): string {
  const what = target?.label ? `"${target.label}"` : target?.tag ? `<${target.tag}>` : t("actionMenu.thisPoint");
  return target?.selector ? what : t("actionMenu.byPosition", { what });
}

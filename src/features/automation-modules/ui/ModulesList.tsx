import { useEffect, useMemo, useState } from "react";
import { Badge, Button, DataList, EmptyState, IconButton, Tooltip, type DataListColumn } from "@proxyshard/shardx-ui-kit";
import {
  automationModuleGrant,
  automationModulePermissions,
  useAutomation,
  type ModuleInfo,
  type ModulePermissions,
} from "../../../entities/automation";
import { AddIcon, CopyIcon, DeleteIcon, NavAutomationIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { clip } from "../../../shared/lib/clipboard";
import { fmtList } from "../../../shared/lib/format";
import { toast } from "../../../shared/model/toast";
import { ListColumn } from "../../../shared/ui/ListColumn";
import { useListLayout, type ListColumnDef } from "../../../shared/ui/listHeader";
import { ANY_PROJECT, allowed, deny, flowGrantId, needsApproval, unanswered } from "../model/requests";

/** Where the list's layout (widths, order, shown columns, sort) is saved. */
export const MODULES_LAYOUT_KEY = "shardx.automation.modules.layout";

type Column = "name" | "file" | "reads" | "request";

/** A file's own name: the last part of its path, from either kind of slash. */
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const COLUMNS: readonly ListColumnDef<Column, ModuleInfo>[] = [
  {
    id: "name", title: (t) => t("modulesCard.colName"), need: 220, min: 160, max: 480, fill: true, shown: true, hideable: false, movable: false,
    compare: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "file", title: (t) => t("modulesCard.colFile"), need: 180, min: 120, max: 360, shown: true, hideable: true, movable: true,
    compare: (a, b) => fileName(a.path).localeCompare(fileName(b.path)),
  },
  { id: "reads", title: (t) => t("modulesCard.colReads"), need: 220, min: 140, max: 400, shown: true, hideable: true, movable: true },
  { id: "request", title: (t) => t("modulesCard.colRequest"), need: 420, min: 260, max: 640, shown: true, hideable: true, movable: true },
];
const ROW_HEIGHT = 52;
/** The row's actions track: Remove (24). */
const ACTIONS_TRACK = 40;

/// The installed modules on the kit DataList, so their layout is saved and
/// the borderless rollout restyles them with every other list. A module's
/// request to call other projects or modules is a column of its row, not a
/// row of its own (the list's rows are one height): "Needs approval", what it
/// wants, its own reason, then Deny and Allow.
export function ModulesList({ modules, loaded, busy, onRemove, onAdd }: {
  modules: ModuleInfo[];
  loaded: boolean;
  busy: string | null;
  onRemove: (m: ModuleInfo) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const projects = useAutomation((s) => s.projects);
  const [perms, setPerms] = useState<ReadonlyMap<string, ModulePermissions>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  // A Deny is kept apart from the backend's answer, so the row needs a render to go.
  const [, answered] = useState(0);

  const ids = modules.map((m) => m.id).join("\n");
  useEffect(() => {
    let alive = true;
    for (const m of modules) {
      automationModulePermissions(m.id).then((p) => { if (alive) setPerms((prev) => new Map(prev).set(m.id, p)); }).catch(() => {});
    }
    return () => { alive = false; };
    // The modules by id: a reload that changes nothing asks nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const flows = projects.map((p) => ({ id: p.id, name: p.name }));
  const names = new Map(modules.map((m) => [m.id, m.name]));

  const allow = async (m: ModuleInfo, perm: ModulePermissions) => {
    const next = allowed(perm, flows);
    setSaving(m.id);
    try {
      await automationModuleGrant(m.id, next.modules, next.flows);
      const fresh = await automationModulePermissions(m.id);
      setPerms((prev) => new Map(prev).set(m.id, fresh));
    } catch (e) {
      toast.fail({ title: t("modulesCard.grantFailed", { name: m.name }), detail: e });
    } finally {
      setSaving(null);
    }
  };
  // One asked project or module at a time: on, or off again. Allow grants the
  // whole request in one go; this is how a part of it is granted, and how a
  // grant is taken back, without removing the module.
  const toggle = async (m: ModuleInfo, perm: ModulePermissions, kind: "module" | "flow", id: string) => {
    const mods = new Set(perm.granted.call_modules);
    const projs = new Set(perm.granted.call_flows);
    const set = kind === "module" ? mods : projs;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setSaving(m.id);
    try {
      await automationModuleGrant(m.id, [...mods], [...projs]);
      const fresh = await automationModulePermissions(m.id);
      setPerms((prev) => new Map(prev).set(m.id, fresh));
    } catch (e) {
      toast.fail({ title: t("modulesCard.grantFailed", { name: m.name }), detail: e });
    } finally {
      setSaving(null);
    }
  };
  /** Every asked project and module that can be granted, each its own switch. */
  const chips = (m: ModuleInfo, perm: ModulePermissions) => {
    const items = [
      ...perm.asks.flows.flatMap((name) => {
        const id = flowGrantId(name, flows);
        if (id === null) return [];
        const what = name === ANY_PROJECT ? t("modulesCard.wantsAnyProject") : t("modulesCard.wantsProject", { name });
        return [{ kind: "flow" as const, id, what, on: perm.granted.call_flows.includes(id) }];
      }),
      ...perm.asks.modules.map((id) => ({
        kind: "module" as const, id, what: t("modulesCard.wantsModule", { name: names.get(id) ?? id }), on: perm.granted.call_modules.includes(id),
      })),
    ];
    if (items.length === 0) return null;
    // A manifest may ask for one project or module twice: one switch each.
    const unique = items.filter((it, i) => items.findIndex((x) => x.kind === it.kind && x.id === it.id) === i);
    return (
      <span data-module-grants className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
        {unique.map((it) => (
          <Tooltip key={`${it.kind}:${it.id}`} content={it.on ? t("modulesCard.revokeItem", { what: it.what }) : t("modulesCard.grantItem", { what: it.what })}>
            <Button
              variant={it.on ? "primary" : "neutral"}
              mode={it.on ? "lighter" : "stroke"}
              size="2xsmall"
              aria-pressed={it.on}
              disabled={saving === m.id}
              onClick={(e) => { e.stopPropagation(); void toggle(m, perm, it.kind, it.id); }}
            >
              <span className="truncate">{it.what}</span>
            </Button>
          </Tooltip>
        ))}
      </span>
    );
  };
  const copyPath = async (m: ModuleInfo) => {
    try {
      await clip.write(m.path);
      toast.ok(t("modulesCard.pathCopied"));
    } catch (e) {
      toast.fail({ title: t("copyField.failed"), detail: e });
    }
  };

  const cells: Record<Column, (m: ModuleInfo) => React.ReactNode> = {
    name: (m) => (
      <div className="min-w-0">
        <div className="truncate text-ui text-text-strong-950">{m.name}</div>
        {m.error ? (
          <div className="truncate text-secondary text-error-text">{t("modulesCard.loadFailed", { error: m.error })}</div>
        ) : (
          <div className="truncate text-secondary text-text-soft-400">
            {m.blocks.length === 0
              ? t("modulesCard.addsNothing")
              : m.blocks.length === 1
                ? t("modulesCard.addsOne", { labels: m.blocks[0].label })
                : t("modulesCard.addsMany", { n: m.blocks.length, labels: m.blocks.map((b) => b.label).join(", ") })}
          </div>
        )}
      </div>
    ),
    file: (m) => (
      <div className="flex min-w-0 items-center gap-1 text-secondary text-text-sub-600">
        <Tooltip content={m.path} side="top">
          <span data-module-file className="truncate">{fileName(m.path)}</span>
        </Tooltip>
        <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <IconButton size="2xsmall" label={t("modulesCard.copyPath")} icon={<CopyIcon className="size-3.5" />} onClick={(e) => { e.stopPropagation(); void copyPath(m); }} />
        </span>
      </div>
    ),
    reads: (m) => {
      const perm = perms.get(m.id);
      if (!perm) return null;
      return (
        <Badge color="gray" className="max-w-full">
          <span className="truncate">
            {perm.asks.vars.length > 0 ? t("modulesCard.readsVars", { vars: fmtList(perm.asks.vars) }) : t("modulesCard.readsOwnVars")}
          </span>
        </Badge>
      );
    },
    request: (m) => {
      const perm = perms.get(m.id);
      if (!perm) return null;
      const open = unanswered(perm, flows);
      const pending = needsApproval(m.id, perm, flows);
      const missing = open.missing.length > 0
        ? (
          <Tooltip content={fmtList(open.missing)}>
            <span data-module-missing className="block truncate text-secondary text-text-soft-400">
              {open.missing.length === 1 ? t("modulesCard.missingOne") : t("modulesCard.missingMany", { n: open.missing.length })}
            </span>
          </Tooltip>
        )
        : null;
      if (!pending) {
        // Answered: what it may use stays in view, and each part can be taken back.
        const granted = chips(m, perm);
        if (!granted) return missing;
        return (
          <div className="flex min-w-0 flex-col justify-center gap-0.5">
            {granted}
            {missing}
          </div>
        );
      }
      const wants = [
        ...open.flows.map((name) => (name === ANY_PROJECT ? t("modulesCard.wantsAnyProject") : t("modulesCard.wantsProject", { name }))),
        ...open.modules.map((id) => t("modulesCard.wantsModule", { name: names.get(id) ?? id })),
      ];
      return (
        <div role="group" aria-label={t("modulesCard.requestFor", { name: m.name })} data-module-request className="flex min-w-0 items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="flex min-w-0 items-center gap-2">
              <Badge color="warning" shape="pill" className="shrink-0">{t("modulesCard.needsApproval")}</Badge>
              <span className="truncate text-body text-text-strong-950">{t("modulesCard.wantsTo", { what: fmtList(wants) })}</span>
            </div>
            {perm.asks.reason ? (
              <Tooltip content={perm.asks.reason} whenTruncated>
                <span className="block truncate text-secondary text-text-soft-400">{t("modulesCard.itsReason", { reason: perm.asks.reason })}</span>
              </Tooltip>
            ) : missing}
          </div>
          <span className="flex shrink-0 gap-1.5">
            <Button variant="neutral" mode="lighter" size="2xsmall" disabled={saving === m.id} onClick={(e) => { e.stopPropagation(); deny(m.id, perm); answered((n) => n + 1); }}>
              {t("modulesCard.deny")}
            </Button>
            <Button variant="primary" mode="filled" size="2xsmall" disabled={saving === m.id} onClick={(e) => { e.stopPropagation(); void allow(m, perm); }}>
              {t("modulesCard.allow")}
            </Button>
          </span>
        </div>
      );
    },
  };

  const list = useListLayout({
    storageKey: MODULES_LAYOUT_KEY,
    defs: COLUMNS,
    items: modules,
    selectable: false,
    tail: ACTIONS_TRACK,
    actionsLabel: t("profileTable.colActions"),
  });
  const columns: DataListColumn<ModuleInfo>[] = useMemo(
    () => list.columns.map((c) => ({ ...c, cell: cells[c.id as Column] })),
    // The cells read the permissions, the projects and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.columns, perms, projects, saving, t],
  );

  return (
    <ListColumn>
      <DataList<ModuleInfo>
        aria-label={t("automation.tabModules")}
        items={list.items}
        columns={columns}
        layout={list.layout}
        rowHeight={ROW_HEIGHT}
        getId={(m) => m.id}
        getName={(m) => m.name}
        labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
        status={loaded ? "ready" : "loading"}
        loading={null}
        empty={<EmptyState icon={<NavAutomationIcon />} title={t("modulesCard.emptyTitle")} hint={t("modulesCard.emptyHint")} action={{ label: t("modulesCard.addButton"), icon: <AddIcon />, onClick: onAdd }} />}
        rowActions={(m) => (
          <IconButton
            size="2xsmall"
            label={t("modulesCard.remove", { name: m.name })}
            icon={<DeleteIcon className="size-3.5" />}
            disabled={busy === m.id}
            className="hover:bg-error-tint hover:text-error-text"
            onClick={(e) => { e.stopPropagation(); onRemove(m); }}
          />
        )}
      />
    </ListColumn>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { Button, cn, Input, Modal, Tooltip } from "@proxyshard/shardx-ui-kit";
import {
  automationModules,
  blockIcon,
  categoryIcon,
  PALETTE,
  type BlockSpec,
  type ModuleInfo,
} from "../../../entities/automation";
import { useT } from "../../../shared/i18n";
import { StepIcon } from "../../../shared/icons";

type Props = {
  open: boolean;
  /** Changes when the modules dialog above the library closes: the modules are read again. */
  modulesSeen?: number;
  onPick: (spec: BlockSpec) => void;
  /** Opens the modules dialog, over the library. */
  onManageModules: () => void;
  onClose: () => void;
};

/** The library, grouped. Adding a step by hand is the ordinary way to build a
 *  project; recording from the live browser is the shortcut. Its footer holds
 *  the one way to the modules (Manage modules): they add steps, so they are
 *  managed from where steps are added. */
export function BlockPicker({ open, modulesSeen = 0, onPick, onManageModules, onClose }: Props) {
  const t = useT();
  const [cat, setCat] = useState(PALETTE[0].id);
  const [q, setQ] = useState("");
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  useEffect(() => { automationModules().then(setModules).catch(() => {}); }, [modulesSeen]);

  // A module's blocks sit in the library beside the built-in ones. Each block
  // chooses its group: a built-in one (by label or id), a new named group, or —
  // with none set — the module's own group. Their kind carries the module id,
  // so the runner knows who to ask.
  const builtinByName = new Map<string, string>(); // lowercased name/id -> real id
  for (const c of PALETTE) {
    builtinByName.set(c.id.toLowerCase(), c.id);
    builtinByName.set(t(c.label).toLowerCase(), c.id);
  }
  const extra = new Map<string, { id: string; label: string; blocks: BlockSpec[] }>();
  for (const m of modules) {
    if (m.error || !m.blocks.length) continue;
    // A module's blocks() is its own text: a kind it lists twice (or leaves out) shows once.
    const seen = new Set<string>();
    for (const b of m.blocks) {
      if (typeof b.kind !== "string" || !b.kind || seen.has(b.kind)) continue;
      seen.add(b.kind);
      const spec: BlockSpec = {
        kind: `module:${m.id}:${b.kind}`,
        label: b.label ?? b.kind,
        about: b.about ?? t("blockPicker.fromModule", { name: m.name }),
        params: (b.params ?? []).map((prm) => ({
          name: prm.name,
          label: prm.label ?? prm.name,
          kind: (prm.kind as BlockSpec["params"][number]["kind"]) ?? "text",
          hint: prm.hint,
          default: prm.default as string | number | undefined,
          secret: prm.secret === true,
        })),
      };
      const wanted = (b.group ?? "").trim();
      const builtin = wanted ? builtinByName.get(wanted.toLowerCase()) : undefined;
      const key = builtin ?? (wanted ? `group:${wanted.toLowerCase()}` : `module:${m.id}`);
      const label = builtin ? "" : wanted || m.name; // built-in keeps its own label
      if (!extra.has(key)) extra.set(key, { id: key, label, blocks: [] });
      extra.get(key)!.blocks.push(spec);
    }
  }
  const broken = modules.filter((m) => m.error);
  // Built-in categories, with module blocks that chose them appended; then any
  // new named / per-module groups.
  const all: { id: string; label: string; blocks: BlockSpec[] }[] = [
    ...PALETTE.map((c) => {
      const add = extra.get(c.id);
      return add ? { ...c, blocks: [...c.blocks, ...add.blocks] } : c;
    }),
    ...[...extra.values()].filter((g) => !PALETTE.some((c) => c.id === g.id)),
  ];

  // The chosen category can vanish under the open library: a module removed
  // in the Modules dialog took its group with it. The first category then.
  const catId = all.some((c) => c.id === cat) ? cat : PALETTE[0].id;
  const query = q.trim().toLowerCase();
  // Searched on what the person sees, not on the key behind it.
  const hits = (c: { blocks: BlockSpec[] }) =>
    c.blocks.filter(
      (b) => t(b.label).toLowerCase().includes(query) || t(b.about).toLowerCase().includes(query),
    );
  const groups = query
    ? all.map((c) => ({ ...c, blocks: hits(c) })).filter((c) => c.blocks.length > 0)
    : all.filter((c) => c.id === catId);
  const hitCount = new Map(groups.map((g) => [g.id, g.blocks.length]));

  // One flat run of rows for the keys: Arrow moves, Enter adds. The pointer
  // moves the same marker, so two rows never wear a fill at once.
  const flat = groups.flatMap((g) => g.blocks.map((b) => ({ b, cat: g.id })));
  const [active, setActive] = useState(0);
  const idx = Math.min(active, Math.max(flat.length - 1, 0));
  const activeCat = flat[idx]?.cat ?? catId;
  const uid = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);
  useEffect(() => { setActive(0); }, [query, catId]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx, flat.length]);

  const pick = (b: BlockSpec) => { onPick(b); onClose(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((idx + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
    } else if (e.key === "Enter" && flat[idx]) {
      e.preventDefault();
      pick(flat[idx].b);
    }
  };

  let row = -1;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("blockPicker.title")}
      size="lg"
      padded={false}
      footer={
        <Button variant="neutral" mode="stroke" size="xsmall" className="mr-auto" onClick={onManageModules}>
          {t("blockPicker.manageModules")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 px-inset-dialog pb-2 pt-2">
        <Input
          inputSize="xsmall"
          placeholder={t("blockPicker.searchPlaceholder")}
          aria-label={t("blockPicker.searchPlaceholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={flat.length ? `${uid}-${idx}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          data-autofocus
        />

        <div className="flex max-h-[360px] min-h-0 gap-2">
          <div role="group" aria-label={t("blockPicker.categories")} className="flex w-[150px] shrink-0 flex-col gap-0.5 overflow-y-auto">
            {all.map((c) => {
              const chosen = c.id === (query ? activeCat : catId);
              const n = hitCount.get(c.id);
              return (
                // eslint-disable-next-line no-restricted-syntax -- list row; the kit's vertical Tabs cannot carry a hit count
                <button
                  key={c.id}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={chosen}
                  className={cn(
                    "flex h-[28px] shrink-0 items-center justify-between gap-2 rounded-8 px-2 text-left text-ui transition-hover",
                    chosen ? "bg-bg-active text-text-strong-950" : "text-text-sub-600 hover:bg-bg-hover hover:text-text-strong-950",
                    query && !n && "text-text-soft-400",
                  )}
                  onClick={() => {
                    if (!query) { setCat(c.id); return; }
                    const at = flat.findIndex((f) => f.cat === c.id);
                    if (at >= 0) setActive(at);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StepIcon
                      icon={categoryIcon(c.id)}
                      className={cn("size-3.5 shrink-0", chosen ? "text-text-strong-950" : "text-text-soft-400")}
                    />
                    <span className="truncate">{t(c.label)}</span>
                  </span>
                  {query && n ? <span className="text-secondary tabular-nums text-text-soft-400">{n}</span> : null}
                </button>
              );
            })}
          </div>

          <div
            ref={listRef}
            id={`${uid}-list`}
            role="listbox"
            aria-label={t("blockPicker.title")}
            data-scrolling={scrolling ? "" : undefined}
            onScroll={() => {
              setScrolling(true);
              window.clearTimeout(scrollTimer.current);
              scrollTimer.current = window.setTimeout(() => setScrolling(false), 700);
            }}
            className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto"
          >
            {groups.map((c) => (
              <div key={c.id} role="group" aria-label={t(c.label)}>
                {query && (
                  <div className="px-2 pb-1 pt-2 text-secondary font-medium text-text-soft-400">{t(c.label)}</div>
                )}
                {c.blocks.map((b) => {
                  row += 1;
                  const mine = row;
                  return (
                    <div
                      key={b.kind}
                      id={`${uid}-${mine}`}
                      role="option"
                      aria-selected={mine === idx}
                      data-row={mine}
                      className={cn(
                        "flex h-[44px] cursor-default flex-col justify-center rounded-8 px-2",
                        mine === idx && "bg-bg-active",
                      )}
                      onMouseMove={() => { if (mine !== idx) setActive(mine); }}
                      onClick={() => pick(b)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <StepIcon
                          icon={blockIcon(b.kind, c.id)}
                          className={cn("size-3.5 shrink-0", mine === idx ? "text-text-strong-950" : "text-text-soft-400")}
                        />
                        <span className="truncate text-ui font-medium text-text-strong-950">{t(b.label)}</span>
                      </div>
                      <Tooltip content={t(b.about)} whenTruncated warm={false}>
                        <div className="truncate pl-[22px] text-secondary text-text-soft-400">{t(b.about)}</div>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            ))}
            {broken.length > 0 && !query && (
              <div className="mt-2 rounded-8 bg-warning-alpha-16 px-2.5 py-1.5 text-secondary text-warning-base">
                {broken.length === 1
                  ? t("blockPicker.modulesFailedOne", { n: broken.length })
                  : t("blockPicker.modulesFailedMany", { n: broken.length })}{" "}
                {broken.map((m) => `${m.id} (${m.error})`).join(", ")}
              </div>
            )}
            {groups.length === 0 && (
              <p className="m-0 px-1 py-6 text-center text-balance text-body text-text-soft-400">
                {t("blockPicker.noMatches", { q })}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

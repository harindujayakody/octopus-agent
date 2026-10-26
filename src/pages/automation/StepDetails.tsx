import { useEffect, useId, useState } from "react";
import { Button, Chip, Input, Switch, Textarea, Tooltip } from "@proxyshard/shardx-ui-kit";
import {
  automationList,
  blockIcon,
  branchKind,
  specFor,
  type Block,
  type Branch,
  type ParamSpec,
  type Project,
} from "../../entities/automation";
import { StepIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { SelectField } from "../../shared/ui/SelectField";
import { NumField } from "../../shared/ui/NumField";

/** Every saved project, loaded once and shared by the pickers below. */
function useProjects(): Project[] {
  const [list, setList] = useState<Project[]>([]);
  useEffect(() => {
    let alive = true;
    automationList()
      .then((ps) => alive && setList(ps))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** Picks a saved project. Stores its id, and its name beside it: an id does not
 *  survive an export and a name is not unique, so a call keeps both. */
function ProjectField({
  block,
  name,
  label,
  onParam,
}: {
  block: Block;
  name: string;
  /** Names the field: a caption beside it does not name a combobox. */
  label: string;
  onParam: (id: string, key: string, value: unknown) => void;
}) {
  const t = useT();
  const projects = useProjects();
  const value = String(block.params[name] ?? "");
  return (
    <div className="min-w-0 flex-1">
      <SelectField
        aria-label={label}
        value={value}
        onChange={(v) => {
          onParam(block.id, name, v);
          onParam(block.id, `${name}Name`, projects.find((p) => p.id === v)?.name ?? "");
        }}
        options={[
          { value: "", label: t("stepDetails.pickFlow") },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
}

/** Picks an entry point inside whichever project a sibling param names. */
function ProjectStepField({
  block,
  name,
  of,
  label,
  onParam,
}: {
  block: Block;
  name: string;
  of: string;
  /** Names the field: a caption beside it does not name a combobox. */
  label: string;
  onParam: (id: string, key: string, value: unknown) => void;
}) {
  const t = useT();
  const projects = useProjects();
  const chosen = projects.find((p) => p.id === String(block.params[of] ?? ""));
  const entries = (chosen?.blocks ?? []).filter((b) => b.kind === "flow.entry");
  return (
    <div className="min-w-0 flex-1">
      <SelectField
        aria-label={label}
        disabled={!chosen}
        value={String(block.params[name] ?? "")}
        onChange={(v) => onParam(block.id, name, v)}
        options={[
          { value: "", label: t("stepDetails.entryDefault") },
          ...entries.map((b) => ({ value: b.id, label: String(b.params.name ?? "") || b.label || b.id.slice(0, 6) })),
        ]}
      />
    </div>
  );
}

/** The browser's element picker, for the step's target. */
export type PickControl = {
  /** A profile is running in the browser column. */
  available: boolean;
  /** The next click on the page becomes this step's target. */
  active: boolean;
  onToggle: () => void;
};

type Props = {
  block: Block | null;
  steps: Block[];
  onParam: (blockId: string, name: string, value: unknown) => void;
  onSecret: (blockId: string, name: string) => void;
  onBranch: (blockId: string, which: "on_done" | "on_fail", b: Branch) => void;
  onToggle: (blockId: string) => void;
  pick?: PickControl;
};

/** A group's small section label. */
const CAPTION = "text-section-label text-text-soft-400";

/** A select value as the panel shows it: sentence case, and names that keep
 *  their own capitals. The stored value never changes. */
const NAMES: Record<string, string> = {
  macos: "macOS", ios: "iOS", sqlite: "SQLite", postgres: "PostgreSQL", mysql: "MySQL",
  mariadb: "MariaDB", mongodb: "MongoDB", socks5: "SOCKS5", http: "HTTP", xhr: "XHR",
};
const optionText = (v: string) => NAMES[v] ?? (/^[a-z][a-z ]*$/.test(v) ? v[0].toUpperCase() + v.slice(1) : v);

/** "When it works" or "When it fails": a label and its choice on one row,
 *  with the step to jump to or the number of tries under the choice. */
function BranchRow({
  title,
  value,
  steps,
  self,
  onChange,
}: {
  title: string;
  value: Branch;
  steps: Block[];
  self: string;
  onChange: (b: Branch) => void;
}) {
  const t = useT();
  const kind = branchKind(value);
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
      <span className="text-body text-text-sub-600">{title}</span>
      <SelectField
        aria-label={title}
        value={kind}
        onChange={(k) => {
          if (k === "goto") {
            const first = steps.find((x) => x.id !== self);
            onChange({ goto: first?.id ?? "" });
          } else if (k === "retry") onChange({ retry: 2 });
          else onChange(k as Branch);
        }}
        options={[
          { value: "next", label: t("stepDetails.branchNext") },
          { value: "goto", label: t("stepDetails.branchGoto") },
          { value: "retry", label: t("stepDetails.branchRetry") },
          { value: "endpass", label: t("stepDetails.branchEndPass") },
          { value: "stop", label: t("stepDetails.branchStop") },
        ]}
      />
      {kind === "goto" && (
        <div className="col-start-2 min-w-0">
          <SelectField
            aria-label={t("stepDetails.branchGoto")}
            value={(value as { goto: string }).goto}
            onChange={(v) => onChange({ goto: v })}
            options={steps.map((x, i) => ({ value: x.id, label: `${i + 1}. ${x.label || x.kind}` }))}
          />
        </div>
      )}
      {kind === "goto" && !steps.some((x) => x.id === (value as { goto: string }).goto) && (
        <p className="col-start-2 m-0 text-secondary text-warning-text">{t("stepDetails.gotoMissing")}</p>
      )}
      {kind === "retry" && (
        <div className="col-start-2 min-w-0">
          <NumField
            aria-label={t("stepDetails.branchRetry")}
            value={(value as { retry: number }).retry}
            min={1}
            max={50}
            onChange={(v) => onChange({ retry: v })}
          />
        </div>
      )}
    </div>
  );
}

/** A number setting holding a `{{variable}}` rather than a number.
 *
 *  The runner resolves one before using it, so `var.random` can feed a wait
 *  or a timeout. A number box cannot show it — it would read the text as no
 *  number at all and write its default over the variable the moment anything
 *  else on the step changed — so the field becomes a text box while a
 *  variable is in it. One gets in through the number box itself: `onVar` hands
 *  a reference typed into it over on leaving (#66). */
const isVarRef = (v: unknown): v is string =>
  typeof v === "string" && v.includes("{{");

/** A stored number setting as a number: imports may carry it as text. */
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** One of the step's own settings, under its small section label. */
function ParamField({ block, prm, onParam, onSecret }: {
  block: Block;
  prm: ParamSpec;
  onParam: Props["onParam"];
  onSecret: Props["onSecret"];
}) {
  const t = useT();
  const label = t(prm.label);
  const id = `step-${block.id}-${prm.name}`;
  const secret = prm.secret && (
    <Tooltip content={block.secrets.includes(prm.name) ? t("stepDetails.secretOn") : t("stepDetails.secretOff")}>
      <Chip
        size="xsmall"
        tone="warning"
        selected={block.secrets.includes(prm.name)}
        onClick={() => onSecret(block.id, prm.name)}
      >
        {t("stepDetails.secretButton")}
      </Chip>
    </Tooltip>
  );
  const row = (control: React.ReactNode) => (
    <div className="flex min-w-0 items-center gap-1.5">
      {control}
      {secret}
    </div>
  );

  // WIG-01: a <label> must not wrap a select (a caption click would change
  // it), and a number field is named by a caption tied with htmlFor (a
  // wrapping label would read its message into its name, F11). Those two,
  // and the project pickers, name their control by id; the text kinds keep
  // a wrapping <label>.
  if (prm.kind === "select" && prm.options) {
    return (
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-label`} className={CAPTION}>{label}</span>
        {row(
          <div className="min-w-0 flex-1">
            <SelectField
              aria-labelledby={`${id}-label`}
              value={String(block.params[prm.name] ?? prm.default ?? "")}
              onChange={(v) => onParam(block.id, prm.name, v)}
              options={prm.options.map((o) => ({ value: o, label: o === "" ? t("stepDetails.anyOption") : optionText(o) }))}
            />
          </div>,
        )}
      </div>
    );
  }
  if (prm.kind === "number") {
    const held = block.params[prm.name];
    if (isVarRef(held)) {
      return (
        <div className="flex flex-col gap-1.5">
          <label id={`${id}-label`} htmlFor={id} className={CAPTION}>{label}</label>
          {row(
            <Input
              id={id}
              type="text"
              inputSize="xsmall"
              wrapperClassName="min-w-0 flex-1"
              value={held}
              onChange={(e) => {
                const text = e.target.value;
                // Leaving the variable behind must put a NUMBER back in the
                // step. Once "{{" is gone this box unmounts and the number
                // field takes over, and that field only *shows* a default —
                // it never writes one. Storing the bare text instead would
                // leave "" in the step while the editor showed 2, and the run
                // would fall back to a third value again.
                if (text.includes("{{")) { onParam(block.id, prm.name, text); return; }
                onParam(block.id, prm.name, numberOf(text) ?? numberOf(prm.default) ?? 0);
              }}
            />,
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <label id={`${id}-label`} htmlFor={id} className={CAPTION}>{label}</label>
        {row(
          <div className="min-w-0 flex-1">
            {/* Keeps what you type (WIG-02): "-" on its way to a negative
                scroll, an empty field on its way to a new timeout. A
                setting with a default needs a number; one without is left
                out when cleared, and its hint says what empty means.
                `onVar` lets a `{{variable}}` be typed in: every step
                number the runner reads goes through its expansion. */}
            {prm.default === undefined ? (
              <NumField
                id={id}
                aria-labelledby={`${id}-label`}
                decimals={prm.decimals ?? 2}
                min={prm.min}
                max={prm.max}
                placeholder={prm.hint ? t(prm.hint) : undefined}
                value={numberOf(block.params[prm.name])}
                onChange={(v) => onParam(block.id, prm.name, v)}
                onClear={() => onParam(block.id, prm.name, undefined)}
                onVar={(ref) => onParam(block.id, prm.name, ref)}
              />
            ) : (
              <NumField
                id={id}
                aria-labelledby={`${id}-label`}
                decimals={prm.decimals ?? 2}
                min={prm.min}
                max={prm.max}
                placeholder={prm.hint ? t(prm.hint) : undefined}
                value={numberOf(block.params[prm.name]) ?? numberOf(prm.default) ?? 0}
                onChange={(v) => onParam(block.id, prm.name, v)}
                onVar={(ref) => onParam(block.id, prm.name, ref)}
              />
            )}
          </div>,
        )}
      </div>
    );
  }
  if (prm.kind === "project" || prm.kind === "projectStep") {
    return (
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className={CAPTION}>{label}</span>
        {row(
          prm.kind === "project" ? (
            <ProjectField block={block} name={prm.name} label={label} onParam={onParam} />
          ) : (
            <ProjectStepField block={block} name={prm.name} of={prm.of ?? "project"} label={label} onParam={onParam} />
          ),
        )}
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1.5">
      <span className={CAPTION}>{label}</span>
      {row(
        prm.kind === "textarea" ? (
          <Textarea
            wrapperClassName="min-w-0 flex-1"
            className="mono"
            technical
            placeholder={prm.hint ? t(prm.hint) : undefined}
            value={String(block.params[prm.name] ?? prm.default ?? "")}
            onChange={(e) => onParam(block.id, prm.name, e.target.value)}
          />
        ) : (
          <Input
            type="text"
            inputSize="xsmall"
            wrapperClassName="min-w-0 flex-1"
            placeholder={prm.hint ? t(prm.hint) : undefined}
            value={String(block.params[prm.name] ?? prm.default ?? "")}
            onChange={(e) => onParam(block.id, prm.name, e.target.value)}
          />
        ),
      )}
    </label>
  );
}

/** The selected step's settings, as the side panel's Step tab: its name and
 *  what it does, its target, whether it runs, where the run goes next, and
 *  its own settings in small groups. Kept out of the canvas so a long list
 *  never moves the cards. */
export function StepDetails({ block, steps, onParam, onSecret, onBranch, onToggle, pick }: Props) {
  const t = useT();
  const uid = useId();
  if (!block) {
    return (
      <p className="m-auto max-w-[28ch] py-8 text-center text-balance text-secondary text-text-soft-400">
        {t("stepDetails.emptyState")}
      </p>
    );
  }
  const spec = specFor(block.kind);
  const params = spec?.params ?? [];
  const selectorParam = params.find((p) => p.name === "selector");
  const sel = typeof block.params.selector === "string" ? block.params.selector : "";
  const hasXY = block.params.x !== undefined && block.params.y !== undefined;
  // What the step aims at, said plainly. A step recorded by position is worth
  // knowing about: it stops being right the moment the window changes size.
  const showTarget = !!selectorParam || !!sel || hasXY;
  const tried = Array.isArray(block.params._tried) ? (block.params._tried as string[]) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 flex items-start gap-2 text-section-title text-text-strong-950 wrap-anywhere">
          <StepIcon icon={blockIcon(block.kind)} className="mt-[3px] size-3.5 shrink-0 text-text-strong-950" />
          <span className="min-w-0">{block.label || (spec?.label ? t(spec.label) : "") || block.kind}</span>
        </h2>
        {spec?.about && <p className="m-0 text-secondary text-text-soft-400">{t(spec.about)}</p>}
      </div>

      {showTarget && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-target`} className={CAPTION}>{t("stepDetails.target")}</label>
          <Input
            id={`${uid}-target`}
            inputSize="xsmall"
            className="mono"
            technical
            placeholder={selectorParam?.hint ? t(selectorParam.hint) : undefined}
            value={sel}
            onChange={(e) => onParam(block.id, "selector", e.target.value)}
            rightAddon={pick && (
              <Tooltip content={t("stepDetails.pickUnavailable")} disabled={pick.available}>
                <Button
                  size="3xsmall" variant="neutral" mode="ghost"
                  // Inside the field's frame: its ring sits inside the button.
                  className="-mr-1 focus-ring-inset"
                  aria-pressed={pick.active}
                  disabled={!pick.available}
                  onClick={pick.onToggle}
                >
                  {pick.active ? t("stepDetails.pickCancel") : t("stepDetails.pick")}
                </Button>
              </Tooltip>
            )}
          />
          {!sel && hasXY && (
            <div className="flex flex-col gap-1">
              <p className="m-0 text-secondary font-medium text-warning-text">
                {t("stepDetails.byPosition", {
                  x: Math.round(Number(block.params.x)),
                  y: Math.round(Number(block.params.y)),
                })}
              </p>
              <p className="m-0 text-secondary text-text-soft-400">{t("stepDetails.noSelectorHelp")}</p>
              {tried.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-micro font-normal text-text-soft-400">
                  {tried.map((line, i) => (
                    <li key={i} className="wrap-anywhere">{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${uid}-run`} className="text-body text-text-strong-950">{t("stepDetails.runThisStep")}</label>
        <Switch id={`${uid}-run`} checked={block.enabled} onChange={() => onToggle(block.id)} />
      </div>

      <div role="group" aria-labelledby={`${uid}-next`} className="flex flex-col gap-1.5">
        <span id={`${uid}-next`} className={CAPTION}>{t("stepDetails.next")}</span>
        <BranchRow
          title={t("stepDetails.onDoneTitle")}
          value={block.on_done}
          steps={steps}
          self={block.id}
          onChange={(v) => onBranch(block.id, "on_done", v)}
        />
        <BranchRow
          title={t("stepDetails.onFailTitle")}
          value={block.on_fail}
          steps={steps}
          self={block.id}
          onChange={(v) => onBranch(block.id, "on_fail", v)}
        />
      </div>

      {params
        .filter((prm) => prm.name !== "selector")
        .map((prm) => (
          <ParamField key={prm.name} block={block} prm={prm} onParam={onParam} onSecret={onSecret} />
        ))}
    </div>
  );
}

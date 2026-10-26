import { useEffect, useId, useRef, useState } from "react";
import { Button, IconButton, Input, Tag, cn, inputFrameClass } from "@proxyshard/shardx-ui-kit";
import type { TrafficHeaderOp } from "../../entities/automation";
import { AddIcon, CloseIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { registerCommittable } from "../../shared/lib/commitField";

const named = (h: TrafficHeaderOp) => h.name.trim() !== "";
const same = (a: TrafficHeaderOp[], b: TrafficHeaderOp[]) => JSON.stringify(a) === JSON.stringify(b);

/// Headers to set, one name and value row each, and "+ Header" for one more.
/// A row without a name is kept on screen while it is typed but never saved:
/// a header with no name is no header.
export function HeaderRows({ value, onChange }: { value?: TrafficHeaderOp[]; onChange: (v: TrafficHeaderOp[] | undefined) => void }) {
  const t = useT();
  const saved = value ?? [];
  const [rows, setRows] = useState<TrafficHeaderOp[]>(saved);
  // A change from elsewhere (Undo) replaces the draft.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setRows((r) => (same(r.filter(named), saved) ? r : saved));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = (next: TrafficHeaderOp[]) => {
    setRows(next);
    const kept = next.filter(named);
    if (!same(kept, saved)) onChange(kept.length > 0 ? kept : undefined);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((h, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5">
          <Input
            inputSize="xsmall" className="mono" technical
            aria-label={t("trafficPanel.headerName")}
            placeholder={t("trafficPanel.headerName")}
            value={h.name}
            onChange={(e) => put(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
          />
          <Input
            inputSize="xsmall" className="mono" technical
            aria-label={t("trafficPanel.headerValue")}
            placeholder={t("trafficPanel.headerValue")}
            value={h.value}
            onChange={(e) => put(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
          />
          <IconButton
            size="2xsmall"
            label={t("trafficPanel.removeHeader")}
            icon={<CloseIcon className="size-3.5" />}
            onClick={() => put(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        variant="neutral" mode="ghost" size="2xsmall"
        className="self-start"
        leftIcon={<AddIcon className="size-3.5" />}
        aria-label={t("trafficPanel.addHeader")}
        onClick={() => setRows([...rows, { name: "", value: "" }])}
      >
        {t("trafficPanel.headerButton")}
      </Button>
    </div>
  );
}

/// Header names to take away, as chips in a field: Enter or a comma adds the
/// name typed, a chip's close removes it.
export function HeaderChips({ value, onChange }: { value?: string[]; onChange: (v: string[] | undefined) => void }) {
  const t = useT();
  const id = useId();
  const list = value ?? [];
  const [text, setText] = useState("");
  const commit = () => {
    // A pasted list may name one header twice: once is enough.
    const names = [...new Set(text.split(",").map((s) => s.trim()))].filter((s) => s && !list.includes(s));
    if (names.length > 0) onChange([...list, ...names]);
    setText("");
  };
  // A save pressed while a half-typed name is in the field takes it first.
  const inputRef = useRef<HTMLInputElement>(null);
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => registerCommittable({ owns: (el) => el === inputRef.current, commit: () => latestCommit.current() }), []);
  const drop = (name: string) => {
    const next = list.filter((n) => n !== name);
    onChange(next.length > 0 ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary text-text-sub-600">{t("trafficPanel.removeHeadersLabel")}</label>
      {/* UI-34: the kit field's own frame; it grows as the chips wrap. */}
      <div className={cn(inputFrameClass({ size: "xsmall", wrap: true }), "gap-1 py-[3px]")}>
        {list.map((n) => (
          <Tag key={n} variant="gray" removeLabel={t("trafficPanel.removeHeader")} onRemove={() => drop(n)}>
            <span className="text-mono">{n}</span>
          </Tag>
        ))}
        {/* eslint-disable-next-line no-restricted-syntax -- chip-entry field inside the header list; the kit has no token input */}
        <input
          ref={inputRef}
          id={id}
          type="text"
          spellCheck={false}
          autoComplete="off"
          className="min-w-[96px] flex-1 border-0 bg-transparent px-1 py-0.5 text-mono text-text-strong-950 outline-hidden placeholder:font-sans placeholder:text-text-soft-400"
          style={{ boxShadow: "none", border: 0 }}
          placeholder={t("trafficPanel.removeHeadersPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
            else if (e.key === "Backspace" && text === "" && list.length > 0) drop(list[list.length - 1]);
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

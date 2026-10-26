import { useEffect, useRef, useState } from "react";
import { cn, inputFrameClass, Label, Tag } from "@proxyshard/shardx-ui-kit";
import { useT } from "../i18n";
import { registerCommittable } from "../lib/commitField";

/// Editable list of ports rendered as removable UI-kit Tags.
export function PortList({
  label, value, onChange,
}: {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const commit = () => {
    // Accept "3389", "3389, 5900", "3389 5900"; drops non-numeric tokens.
    const toks = text.split(/[\s,]+/).filter(Boolean);
    if (toks.length === 0) return;
    const next = new Set(value);
    for (const t of toks) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 65535) next.add(n);
    }
    onChange([...next].sort((a, b) => a - b));
    setText("");
  };
  // A save pressed while a half-typed port is in the field takes it first.
  const inputRef = useRef<HTMLInputElement>(null);
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  useEffect(() => registerCommittable({ owns: (el) => el === inputRef.current, commit: () => latestCommit.current() }), []);
  const remove = (p: number) => onChange(value.filter((x) => x !== p));
  return (
    <label className="flex flex-col gap-[6px]">
      <Label as="span">{label}</Label>
      {/* UI-34: the kit field's own frame, so it looks and focuses like the
          xsmall fields beside it; it grows as the ports wrap. */}
      <div className={cn(inputFrameClass({ size: "xsmall", wrap: true }), "gap-1.5 py-[3px]")}>
        {value.map((p) => (
          <Tag key={p} variant="gray" onRemove={() => remove(p)}>
            <span className="text-mono">{p}</span>
          </Tag>
        ))}
        {/* eslint-disable-next-line no-restricted-syntax -- chip-entry field inside the port list; the kit has no token input */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          className="min-w-[100px] flex-1 border-0 bg-transparent px-1 py-0.5 text-secondary text-text-strong-950 outline-hidden"
          style={{ boxShadow: "none", border: 0 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); commit(); } }}
          onBlur={commit}
          placeholder={value.length === 0 ? t("portList.placeholderEmpty") : t("portList.placeholderAdd")}
        />
      </div>
    </label>
  );
}

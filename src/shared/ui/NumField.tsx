import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Input } from "@proxyshard/shardx-ui-kit";
import { useT } from "../i18n";
import { parseNumber as parse } from "../lib/parseNumber";
import { registerCommittable } from "../lib/commitField";

/** What a value shows as: nothing for an optional number left empty. */
const textOf = (v: number | null) => (v === null ? "" : String(v));

/** Exactly one `{{name}}` and nothing else. A brace or a space inside is a
 *  typo, not a name, and half of one ("{{d") is still being typed. */
const VAR_REF = /^\{\{[^\s{}]+\}\}$/;

/** How a field is named, one way only, so none compiles unnamed: its own
 *  caption (`label`), an `aria-label`, or the id of the caller's caption
 *  (`aria-labelledby`, beside that caption's `<label htmlFor={id}>`). */
type Naming =
  | { label: string; "aria-label"?: never; "aria-labelledby"?: never }
  | { label?: never; "aria-label": string; "aria-labelledby"?: never }
  | { label?: never; "aria-label"?: never; "aria-labelledby": string };

/** A value that may be empty (null) must say what emptying it does. */
type Emptying =
  | { value: number; onClear?: () => void }
  | {
      /** null shows an empty field. */
      value: number | null;
      /** The field may be empty (an optional number): clearing it calls this,
       *  and leaving it empty shows no message. */
      onClear: () => void;
    };

export type NumFieldProps = Naming & Emptying & {
  onChange: (v: number) => void;
  /** Takes a `{{variable}}` typed in place of a number, on leaving the field.
   *  Only settings the runner expands before using them offer this (a wait of
   *  `{{delay}}`); the caller stores the text and shows it in a text box of
   *  its own, so this field never has to display one. Without a handler a
   *  reference is "not a number", as it was. */
  onVar?: (ref: string) => void;
  min?: number;
  max?: number;
  /** Digits after the point that are kept; 0 means whole numbers. */
  decimals?: number;
  /** What an empty field means ("leave empty for the profile's own"). */
  placeholder?: string;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  /** The text shown is not a number in range (a letter, an emptied required
   *  field, "-" on its way): `onChange` has not been called for it, so the
   *  value the caller holds is not what the field shows. A form holds its
   *  Save while this is true. Called with false again once the text reads as
   *  a number, is brought into range, or the field goes (Pair 18 fix round,
   *  Edit proxy review I2). */
  onInvalid?: (invalid: boolean) => void;
};

/// A number field that keeps what you type (WIG-02). The text is a draft:
/// every draft that reads as a number inside the range reaches `onChange`, so
/// a form's own draft holds it; "-" on its way to "-33" and an empty
/// field on its way to a new port stay as they are. Leaving the field (or
/// Enter) brings a number into range, keeps a non-number with a message, or —
/// where the caller takes one — hands over a `{{variable}}`.
/// A text field, so it has no spinner arrows. The types make every field
/// named, and every field that can be empty say what emptying it does.
export function NumField(props: NumFieldProps) {
  const {
    label, "aria-label": ariaLabel, "aria-labelledby": labelledBy,
    value, onChange, onClear, onVar, min, max, decimals = 0, placeholder, id, className,
    "aria-describedby": describedBy, onInvalid,
  } = props;
  const t = useT();
  const [text, setText] = useState(textOf(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // What `onInvalid` was last told, so it hears of a change only.
  const told = useRef(false);
  const latestInvalid = useRef(onInvalid);
  latestInvalid.current = onInvalid;
  const report = useCallback((bad: boolean) => {
    if (told.current === bad) return;
    told.current = bad;
    latestInvalid.current?.(bad);
  }, []);
  // A value changed elsewhere (a reload, a pick) shows, unless you are typing
  // here; it replaces a draft that was kept with a message, and the message.
  useEffect(() => {
    if (focused.current) return;
    setText(textOf(value));
    setError(null);
    report(false);
  }, [value, report]);

  const round = (n: number) => (decimals > 0 ? Number(n.toFixed(decimals)) : Math.round(n));
  const inRange = (n: number) => (min === undefined || n >= min) && (max === undefined || n <= max);
  const message = min !== undefined && max !== undefined ? t("numField.invalidRange", { min, max }) : t("numField.invalid");

  const commit = () => {
    const typed = text.trim();
    // A finished reference goes over as typed, and only on leaving: handing it
    // over mid-word would swap this field for the caller's text box under the
    // keyboard, and the rest of the name would land nowhere. The field is on
    // its way out, so its unmount has nothing of its own left to commit.
    if (onVar && VAR_REF.test(typed)) {
      focused.current = false;
      setError(null);
      report(false);
      onVar(typed);
      return;
    }
    const n = parse(text, decimals);
    if (n === null && onClear && text.trim() === "") { setError(null); setText(""); report(false); if (value !== null) onClear(); return; }
    if (n === null) { setError(message); report(true); return; }
    setError(null);
    report(false);
    // Only what was typed is rounded and brought into range: passing through
    // a field never rewrites a stored value (a coordinate with more digits).
    const kept = n === value ? value : round(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
    setText(String(kept));
    if (kept !== value) onChange(kept);
  };
  // Taken away while you type (a keyed panel switching to another step): no
  // blur comes, so the draft is committed here, brought into range as a
  // leave would (F11 fix round 3). Only while focused: any other unmount has
  // nothing of its own to commit.
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  // The field going takes its complaint with it: the caller holds its Save only for text still shown.
  useEffect(() => () => { if (focused.current) latestCommit.current(); report(false); }, [report]);
  // A save pressed while this field has the keyboard commits it first
  // (`commitFocusedField`), as leaving it would.
  useEffect(() => registerCommittable({ owns: (el) => el === inputRef.current, commit: () => latestCommit.current() }), []);

  return (
    <Input
      ref={inputRef}
      id={id}
      label={label}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      inputSize="xsmall"
      // Label to control is 6 px on kit-labelled fields.
      wrapperClassName="gap-[6px]"
      type="text"
      // A field that takes a reference needs the braces on the keyboard too.
      inputMode={onVar ? "text" : decimals > 0 || (min !== undefined && min < 0) ? "decimal" : "numeric"}
      placeholder={placeholder}
      value={text}
      error={error ?? undefined}
      className={className}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (error) setError(null);
        const n = parse(v, decimals);
        if (n !== null && inRange(n)) {
          report(false);
          if (round(n) !== value) onChange(round(n));
        } else if (onClear && v.trim() === "") {
          report(false);
          if (value !== null) onClear();
        } else {
          // Typed past the range it comes back in on leaving; a letter or an
          // emptied field has no number to hold yet.
          report(true);
        }
      }}
      onBlur={() => { focused.current = false; commit(); }}
      // In a dialog form Enter also submits (C20a): the value in range lands
      // before the submit reads it, so what is shown is what is sent. The
      // Enter that confirms an input method's composition is not a leave: the
      // text is still being written (F11 review).
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) flushSync(commit);
      }}
    />
  );
}

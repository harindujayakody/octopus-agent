// Real-browser test page for the kit's overlays. jsdom ignores layout and
// visibility, so focus and positioning are checked here by e2e/kit-overlays.spec.ts.
// Served by the dev server at /e2e/kit/overlays.html; never part of a build.
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertModal, Button, Combobox, DialogModal, IconButton, Menu, Modal, Popover, Select } from "@proxyshard/shardx-ui-kit";
import { MultiSelect } from "../../src/shared/ui/MultiSelect";
import "../../src/app/styles/index.css";

const Dot = () => <svg viewBox="0 0 10 10" width="16" height="16"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>;

function MenuDemo() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <section>
      <IconButton ref={anchor} icon={<Dot />} label="More actions" onClick={() => setOpen((o) => !o)} />
      <Menu
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        aria-label="Actions"
        items={[
          { label: "Rename", onSelect: () => setPicked("rename") },
          { label: "Duplicate", onSelect: () => setPicked("duplicate") },
          { label: "Delete", onSelect: () => setPicked("delete"), danger: true },
        ]}
      />
      <output data-testid="picked">{picked}</output>
    </section>
  );
}

function PopoverDemo({ label, bottom = false }: { label: string; bottom?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(1);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <section style={bottom ? { position: "fixed", bottom: 20, left: 20 } : undefined}>
      <Button ref={anchor} size="small" onClick={() => setOpen((o) => !o)}>{label}</Button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} aria-label={`${label} panel`} className="w-64 p-3">
        <input aria-label={`${label} field`} />
        <button type="button" onClick={() => setRows((r) => r + 8)}>grow</button>
        {Array.from({ length: rows }, (_, i) => <div key={i} style={{ height: 24 }}>row {i}</div>)}
      </Popover>
    </section>
  );
}

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <Button size="small" onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Dialog with icon first" showClose={false}>
        <IconButton icon={<Dot />} label="Pin" />
        <button type="button">second</button>
      </Modal>
    </section>
  );
}

function LoadingDemo() {
  return (
    <section>
      <Button size="small" isLoading aria-label="Saving">Save</Button>
    </section>
  );
}

function LayoutDemo() {
  return (
    <section data-testid="row" style={{ display: "flex", width: 400, border: "1px solid" }}>
      <span>left</span>
      <IconButton icon={<Dot />} label="Pushed right" className="ml-auto" />
    </section>
  );
}

// Fix round 1 (I2): `pointer-events-none` on a disabled Button/Select
// option made the pointer hit-test whatever sat underneath it, so
// `cursor: not-allowed` never actually reached the user. This demo gives
// e2e/kit-overlays.spec.ts a real disabled Button and a real disabled
// Select option to hit-test with `document.elementFromPoint`.
function DisabledDemo() {
  return (
    <section style={{ display: "flex", gap: 12 }}>
      <Button size="small" disabled>Disabled button</Button>
      <Select
        aria-label="Status"
        value="a"
        onChange={() => {}}
        options={[{ label: "Alpha", value: "a" }, { label: "Beta (disabled)", value: "b", disabled: true }]}
      />
    </section>
  );
}

// Audit Phase B (F3): a click right after Esc lands on the page. Each overlay
// opens over a tall page button, so an overlay that still took the pointer
// while it faded out would catch that click instead.
type CloseKind = "menu" | "popover" | "modal" | "dialog" | "alert";
function CloseDemo({ kind }: { kind: CloseKind }) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const name = `Esc test ${kind}`;
  return (
    <section>
      <Button ref={anchor} size="small" onClick={() => setOpen(true)}>{name}</Button>
      <button type="button" style={{ display: "block", width: 200, height: 160 }} onClick={() => setHits((n) => n + 1)}>
        {kind} target <output data-testid={`${kind}-hits`}>{hits}</output>
      </button>
      {kind === "menu" && (
        <Menu open={open} onOpenChange={setOpen} anchor={anchor} aria-label={name} items={[{ label: "First", onSelect: () => {} }, { label: "Second", onSelect: () => {} }]} />
      )}
      {kind === "popover" && (
        <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} aria-label={name} className="w-40 p-3">
          <input aria-label={`${name} field`} style={{ width: "100%" }} />
        </Popover>
      )}
      {kind === "modal" && <Modal open={open} onClose={close} title={name}><button type="button">inside</button></Modal>}
      {kind === "dialog" && <DialogModal open={open} onClose={close} title={name} />}
      {kind === "alert" && <AlertModal open={open} onClose={close} onConfirm={close} confirmLabel="Continue" title={name} />}
    </section>
  );
}

// Audit Phase C Task 17: the Combobox in a popover, over 1,000 options
// (windowed), each with a host hint the filter also matches.
const PROXIES = Array.from({ length: 1000 }, (_, i) => ({
  value: `p${i}`,
  label: `Proxy ${String(i).padStart(4, "0")}`,
  hint: `10.0.${Math.floor(i / 250)}.${i % 250}:1080`,
}));
function ComboboxDemo() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <section>
      <Button ref={anchor} size="small" onClick={() => setOpen((o) => !o)}>Pick a proxy</Button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} aria-label="Proxy picker" className="w-80">
        <Combobox aria-label="Proxy" options={PROXIES} value={picked || null} onChange={(v) => { setPicked(v); setOpen(false); }} />
      </Popover>
      <output data-testid="picked-proxy">{picked}</output>
    </section>
  );
}

// Multiple: check boxes, a mixed state and a create row; the list stays open.
function TagsComboboxDemo() {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState([
    { value: "ads", label: "Ads" },
    { value: "warm", label: "Warm-up", hint: "12" },
    { value: "shop", label: "Shop" },
  ]);
  const [value, setValue] = useState<string[]>(["ads"]);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <section>
      <Button ref={anchor} size="small" onClick={() => setOpen((o) => !o)}>Edit tags</Button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} aria-label="Tags picker" className="w-64">
        <Combobox
          aria-label="Tags"
          multiple
          options={tags}
          value={value}
          mixed={["shop"]}
          onChange={(v, checked) => setValue((s) => (checked ? [...s, v] : s.filter((x) => x !== v)))}
          onCreate={(name) => {
            const v = name.toLowerCase();
            setTags((t) => [...t, { value: v, label: name }]);
            setValue((s) => [...s, v]);
          }}
        />
      </Popover>
      <output data-testid="tags">{value.join(",")}</output>
    </section>
  );
}

// The app's MultiSelect on the kit Combobox (E19, IFACE-04).
function MultiSelectDemo() {
  const [value, setValue] = useState("");
  const options = [
    { value: "US", label: "United States" }, { value: "DE", label: "Germany" },
    { value: "JP", label: "Japan" }, { value: "GB", label: "United Kingdom" },
  ];
  return (
    <section>
      <MultiSelect value={value} onChange={setValue} options={options} placeholder="Countries" />
      <output data-testid="countries">{value}</output>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ padding: 24, display: "grid", gap: 24 }}>
      <MenuDemo />
      <PopoverDemo label="Filters" />
      <PopoverDemo label="Bottom" bottom />
      <ModalDemo />
      <LoadingDemo />
      <LayoutDemo />
      <DisabledDemo />
      <div style={{ display: "flex", gap: 24 }}>
        <ComboboxDemo />
        <TagsComboboxDemo />
        <MultiSelectDemo />
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        {(["menu", "popover", "modal", "dialog", "alert"] as const).map((k) => <CloseDemo key={k} kind={k} />)}
      </div>
    </main>
  </StrictMode>,
);

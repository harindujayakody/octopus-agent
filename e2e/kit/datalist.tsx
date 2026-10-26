// Real-browser test page for the kit DataList with a saved layout
// (useListLayout), before any screen uses it (F23; Trash, Bookmarks,
// Extensions and Fingerprints adopt it later). Served by the dev server at
// /e2e/kit/datalist.html; never part of a build. Read by e2e/datalist.spec.ts.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataList } from "@proxyshard/shardx-ui-kit";
import { useListLayout, type ListColumnDef } from "../../src/shared/ui/listHeader";
import "../../src/app/styles/index.css";
// The pinned parts' rules (`list-pin-*`), as the app loads them.
import "../../src/app/styles/app.css";

type Row = { id: string; name: string; folder: string; size: number };
const NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "A very long name that nobody else comes close to"];
const ROWS: Row[] = NAMES.map((name, i) => ({ id: `r${i}`, name, folder: i % 3 ? "Shops" : "", size: (i * 37) % 100 }));

type Id = "name" | "folder" | "size";
const DEFS: readonly ListColumnDef<Id, Row>[] = [
  { id: "name", title: () => "Name", need: 120, min: 80, max: 480, shown: true, hideable: false, movable: false, text: (r) => r.name, compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "folder", title: () => "Folder", need: 100, min: 64, max: 320, shown: true, hideable: true, movable: true, text: (r) => r.folder, role: "secondary" },
  { id: "size", title: () => "Size", need: 72, min: 56, max: 160, shown: true, hideable: true, movable: true, text: (r) => `${r.size} MB`, role: "tabular", compare: (a, b) => a.size - b.size },
];
const LABELS = { selectAll: "Select all", select: (n: string) => `Select ${n}`, more: "More actions", actions: "Actions" };

/** `?noSelect`: a list that selects nothing (no select box). */
const selectable = !new URLSearchParams(location.search).has("noSelect");

function Page() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const list = useListLayout({ storageKey: "shardx.test.datalist.layout", defs: DEFS, items: ROWS, selectable, selecting: selected.size > 0, tail: 40, actionsLabel: "Actions" });
  return (
    <main className="flex h-screen w-[520px] bg-bg-weak-50 p-4 text-ui text-text-strong-950">
      <DataList<Row>
        aria-label="Things"
        items={list.items}
        columns={list.columns}
        layout={list.layout}
        getId={(r) => r.id}
        getName={(r) => r.name}
        labels={LABELS}
        status="ready"
        selected={selectable ? selected : undefined}
        onSelectedChange={selectable ? setSelected : undefined}
        menuItems={(r) => [{ label: `Delete ${r.name}`, danger: true, onSelect: () => {} }]}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);

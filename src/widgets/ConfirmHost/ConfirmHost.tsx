import { Button, Modal, useLatched } from "@proxyshard/shardx-ui-kit";
import { useConfirmStore } from "../../shared/model/confirm";

/// Global confirm dialog — UI-kit Modal fed by the zustand confirm store.
export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  // The question stays on screen while the dialog leaves.
  const shown = useLatched(req);
  if (!shown) return null;
  const done = (v: unknown) => { if (req) req.resolve(v); };
  const danger = shown.buttons.some((b) => b.danger);
  return (
    <Modal
      open={req != null}
      onOpenChange={(o) => { if (!o) done(null); }}
      // A destructive or irreversible question is read with its consequence on open (A11Y-07).
      role={danger || shown.alert ? "alertdialog" : "dialog"}
      size="sm"
      title={shown.title}
      description={shown.message}
      footer={shown.buttons.map((b, i) => (
        <Button
          key={i}
          size="xsmall"
          variant={b.danger ? "error" : b.primary ? "primary" : "neutral"}
          mode={b.danger || b.primary ? "filled" : "stroke"}
          onClick={() => done(b.value)}
        >
          {b.label}
        </Button>
      ))}
    >
      {/* What the question is about, one per line (the profiles a Quit closes). */}
      {shown.items?.length ? (
        <ul data-confirm-items className="list-tile m-0 flex max-h-[240px] list-none flex-col overflow-auto">
          {shown.items.map((it, i) => (
            <li key={i} className="row-line relative flex min-w-0 flex-col gap-0.5 px-cell py-2">
              <span className="truncate text-secondary font-medium text-text-strong-950">{it.label}</span>
              {it.note && <span className="text-secondary text-text-sub-600">{it.note}</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

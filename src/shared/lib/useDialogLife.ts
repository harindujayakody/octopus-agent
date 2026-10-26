import { useState } from "react";
import { usePresence } from "@proxyshard/shardx-ui-kit";

/// A dialog or popover that its parent opens and closes. `mounted` keeps its
/// body, with its state and data loads, alive through the overlay's exit and
/// drops it afterwards; `session` changes on every opening, so a body keyed on
/// it starts fresh, as it did when it was mounted only while open (FEEL-01).
///
/// Sessions are numbered across the whole app, not per dialog: two siblings
/// with a counter each got equal keys, React kept one of them and the other's
/// portal stayed on screen for good.
let lastSession = 0;

export function useDialogLife(open: boolean): { mounted: boolean; session: number } {
  // No element: the kit's cap (longer than any overlay exit) ends the life.
  const life = usePresence(open, { maxExitMs: 400 });
  const [session, setSession] = useState(() => ++lastSession);
  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) setSession(++lastSession);
  }
  return { mounted: life.mounted, session };
}

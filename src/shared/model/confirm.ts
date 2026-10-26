import { create } from "zustand";
import type { ConfirmButton, ConfirmItem, ConfirmReq } from "../types";
import { t } from "../i18n";

/// Imperative confirm dialog backed by a zustand store; the ConfirmHost
/// widget renders the current request with the UI-kit modal.
type ConfirmState = {
  req: ConfirmReq | null;
  ask: (req: ConfirmReq) => void;
  clear: () => void;
};

export const useConfirmStore = create<ConfirmState>((set) => ({
  req: null,
  ask: (req) => set({ req }),
  clear: () => set({ req: null }),
}));

type ConfirmOptions = { title: string; message: string; items?: ConfirmItem[] } & (
  | { buttons: ConfirmButton[] }
  /** The confirm button names its action: "Delete proxy", "Empty Trash" (WRITE-02). */
  | { confirmLabel: string; danger?: boolean; alert?: boolean }
);

export function confirmModal(opts: ConfirmOptions): Promise<any> {
  return new Promise((resolve) => {
    // Callers pass text that is already translated; Cancel is the only word
    // this helper owns.
    const buttons = "buttons" in opts
      ? opts.buttons
      : [
          { label: t("confirm.cancel"), value: false },
          { label: opts.confirmLabel, value: true, danger: opts.danger, primary: !opts.danger },
        ];
    useConfirmStore.getState().ask({
      title: opts.title,
      message: opts.message,
      items: opts.items,
      buttons,
      // An act that cannot be taken back (a purchase) is an alert dialog (A11Y-07).
      alert: "confirmLabel" in opts && !!opts.alert,
      resolve: (v) => {
        useConfirmStore.getState().clear();
        resolve(v);
      },
    });
  });
}

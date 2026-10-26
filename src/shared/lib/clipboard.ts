import { invoke } from "@tauri-apps/api/core";

// OS clipboard via Tauri plugin (webview navigator.clipboard throws).
export const clip = {
  write: (text: string) => invoke("clipboard_write", { text }),
  read: () => invoke<string>("clipboard_read"),
};

/** How long a copied secret stays on the clipboard (SEC-11). */
export const SECRET_CLEAR_MS = 60_000;

/// Copies a secret, then clears the clipboard a minute later unless something
/// else was copied meanwhile: clipboard managers and synced clipboards keep
/// whatever sits there (SEC-11; a concealed write is backend B26).
export async function copySecret(text: string): Promise<void> {
  await clip.write(text);
  setTimeout(() => {
    void clip.read()
      .then((now) => (now === text ? clip.write("") : undefined))
      .catch(() => {});
  }, SECRET_CLEAR_MS);
}

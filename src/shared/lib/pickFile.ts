import { t } from "../i18n";

export const MB = 1024 * 1024;
/** The longest clipboard text an import reads (SEC-07). */
export const CLIPBOARD_MAX_CHARS = 5 * MB;

/** A pick larger than allowed: refused before it is read (SEC-07). */
export class FileTooBig extends Error {
  constructor(fileName: string, maxBytes: number) {
    super(t("files.tooBig", { name: fileName, max: `${Math.round(maxBytes / MB)} MB` }));
  }
}

/** The clipboard-import message when `text` is over `CLIPBOARD_MAX_CHARS`,
 *  or null when it fits. One helper so every caller names the same size, and
 *  a changed cap never leaves a copied "5 MB" behind (review, Tasks 24-26). */
export function clipboardTooBig(text: string): string | null {
  return text.length > CLIPBOARD_MAX_CHARS
    ? t("files.clipboardTooBig", { max: `${Math.round(CLIPBOARD_MAX_CHARS / MB)} MB` })
    : null;
}

/// Asks for one file with the webview's own picker and reads it as text. The
/// file never passes through a backend command that can read any path
/// (SEC-07, backend B7), and one over `maxBytes` is refused before it is
/// read, so a mis-pick cannot hang the window. Null when the user cancels.
export function pickTextFile({ accept, maxBytes }: { accept: string; maxBytes: number }): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    const done = () => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      done();
      if (!file) { resolve(null); return; }
      if (file.size > maxBytes) { reject(new FileTooBig(file.name, maxBytes)); return; }
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    }, { once: true });
    input.addEventListener("cancel", () => { done(); resolve(null); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

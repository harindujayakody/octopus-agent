import { create } from "zustand";

type Politeness = "polite" | "assertive";

/// What the app's two live regions say now (`LiveAnnouncer` renders them).
export const useAnnouncer = create<Record<Politeness, string>>(() => ({ polite: "", assertive: "" }));

const waiting: Record<Politeness, string[]> = { polite: [], assertive: [] };

/// Says `text` to screen readers once, without moving focus (A11Y-05). The
/// region is emptied and refilled on the next frame, so the same words said
/// twice are said twice. Texts raised in the same frame are said together:
/// the region holds one message, so a second one would replace the first.
export function announce(text: string, politeness: Politeness = "polite"): void {
  if (!text) return;
  const queue = waiting[politeness];
  queue.push(text);
  if (queue.length > 1) return; // this frame's refill is already on its way
  useAnnouncer.setState({ [politeness]: "" });
  requestAnimationFrame(() => {
    const said = queue.splice(0);
    const message = said.length === 1 ? said[0] : said.map((s) => (/[.!?。！？]$/.test(s) ? s : `${s}.`)).join(" ");
    useAnnouncer.setState({ [politeness]: message });
  });
}

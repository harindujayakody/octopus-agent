import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "@proxyshard/shardx-ui-kit";

/** A motion token's value, read where the kit defines it, so the glide
 *  follows a retune of the tokens (the Live layer retunes them in one place). */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function ms(value: string): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return value.endsWith("ms") ? n : n * 1000;
}
/** The vertical part of an element's current `transform` (a glide under way). */
function shiftOf(el: HTMLElement): number {
  const transform = getComputedStyle(el).transform;
  return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
}

/// When a toast leaves or arrives, the others glide to their new place (FLIP,
/// animations.md S6) instead of jumping. The glide animates `transform` with
/// the Web Animations API, so it composes with the enter and exit
/// `translate` and leaves the element's own transitions alone. A glide
/// interrupted by the next change starts again from where the toast shows.
/// Places are layout offsets (no enter, exit or glide shift in them, and in
/// layout px under the Interface size zoom), measured from the list's bottom
/// edge, the edge the stack grows from: the whole stack moving (a bulk bar
/// showing) is not a glide.
export function useGlide(root: React.RefObject<HTMLElement | null>, key: unknown) {
  const tops = useRef(new Map<string, number>());
  const glides = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    const next = new Map<string, number>();
    const still = prefersReducedMotion();
    const bottom = list.offsetTop + list.offsetHeight;
    let timing: KeyframeAnimationOptions | null = null;
    for (const el of list.querySelectorAll<HTMLElement>("[data-toast]")) {
      const id = el.dataset.toast!;
      const running = glides.current.get(id);
      glides.current.delete(id);
      // How far a glide under way has it from its old place, then stop it.
      const shift = running ? shiftOf(el) : 0;
      running?.cancel();
      // The toast and the list share one offset parent (the fixed stack).
      const top = el.offsetTop - bottom;
      next.set(id, top);
      const before = tops.current.get(id);
      if (before === undefined || still) continue;
      const from = before + shift - top;
      if (Math.abs(from) < 0.5) continue;
      timing ??= {
        duration: ms(token("--motion-slow")),
        easing: token("--ease-in-out") || token("--ease-out") || "ease-in-out",
      };
      const glide = el.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], timing);
      glides.current.set(id, glide);
      glide.onfinish = () => { if (glides.current.get(id) === glide) glides.current.delete(id); };
    }
    tops.current = next;
  }, [root, key]);
}

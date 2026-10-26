import { useSyncExternalStore } from "react";
import { useInterfaceSize } from "../model/interfaceSize";

const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

/// The window is narrower than `width` layout px (1280 by default: Peek is
/// 360 px instead of 420, and the sidebar folds to its rail for it). Interface size counts (CSS
/// zoom does not change the viewport a media query sees), so 1280 at 125% is
/// narrow like 1024 at 100%: use this, not a `min-[…]` media query.
/// The snapshot is the answer, not the width: a resize re-renders a page only
/// when it crosses the line, as the media query it replaces did.
export function useNarrowWindow(width = 1280): boolean {
  const zoom = useInterfaceSize((s) => s.size) / 100;
  return useSyncExternalStore(subscribe, () => window.innerWidth / zoom < width);
}

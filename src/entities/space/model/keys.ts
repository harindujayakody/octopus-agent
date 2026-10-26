import { useSpace } from "./store";
import type { Space } from "./types";

const suffix = (space: Space | undefined) => (space?.kind === "team" ? `@${space.team_id}` : "");

/** A key of this window's storage for the space the launcher works in: the
 *  personal space keeps the plain key, a team's has its id after it. */
export function spaceKey(base: string): string {
  return base + suffix(useSpace.getState().state?.space);
}

/** Runs `fn` each time the launcher moves to another space. */
export function onSpaceChange(fn: () => void): () => void {
  return useSpace.subscribe((s, prev) => {
    if (suffix(s.state?.space) !== suffix(prev.state?.space)) fn();
  });
}

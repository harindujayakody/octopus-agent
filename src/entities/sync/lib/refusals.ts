import type { SYNC_REFUSALS } from "../model/types";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A refusal of SYNC_REFUSALS as a pattern; the device or host in it is the first group. */
export function refusal(words: (typeof SYNC_REFUSALS)[keyof typeof SYNC_REFUSALS]): RegExp {
  if (typeof words === "string") return new RegExp(`\\b${esc(words)}\\b`, "i");
  const [before, after] = words("\u0000").split("\u0000").map(esc);
  return new RegExp(`${before}(.+?)${after}`, "i");
}

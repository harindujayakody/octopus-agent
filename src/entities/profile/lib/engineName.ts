import type { EngineId } from "../model/types";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** A row's browser, as written (absent or unknown is the Octopus Agent engine). */
export const engineOf = (engine: string | null | undefined): EngineId =>
  engine === "chrome" || engine === "chromium" || engine === "firefox" ? engine : "shardx";

/** The short name of the browser a profile starts in, for the list's Browser column. */
export function engineLabel(engine: string | null | undefined, t: TFn): string {
  const e = engineOf(engine);
  return e === "chrome" ? t("profileForm.engineChrome")
    : e === "chromium" ? t("profileForm.engineChromium")
    : e === "firefox" ? t("profileForm.engineFirefox")
    : t("profileTable.engineOctopus");
}

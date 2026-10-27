import type { EngineId } from "../model/types";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** The browsers installed from the Browsers page, in its order (engines.rs `STOCK`). */
export const STOCK_ENGINES = ["chrome", "chromium", "firefox", "brave", "thorium", "helium"] as const satisfies readonly EngineId[];

/** A row's browser, as written (absent or unknown is the Octopus Agent engine). */
export const engineOf = (engine: string | null | undefined): EngineId =>
  (STOCK_ENGINES as readonly string[]).includes(engine ?? "") ? (engine as EngineId) : "shardx";

/** The short name of the browser a profile starts in (the list's Browser column, the Browsers page). */
export function engineLabel(engine: string | null | undefined, t: TFn): string {
  const e = engineOf(engine);
  return e === "chrome" ? t("profileForm.engineChrome")
    : e === "chromium" ? t("profileForm.engineChromium")
    : e === "firefox" ? t("profileForm.engineFirefox")
    : e === "brave" ? t("profileForm.engineBrave")
    : e === "thorium" ? t("profileForm.engineThorium")
    : e === "helium" ? t("profileForm.engineHelium")
    : t("profileTable.engineOctopus");
}

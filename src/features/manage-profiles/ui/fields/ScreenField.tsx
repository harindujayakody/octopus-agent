import { useEffect, useMemo, useState } from "react";
import { SelectField, optionsOf } from "../../../../shared/ui/SelectField";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { SCREEN_RESOLUTIONS } from "../../../../shared/constants";
import { hostScreen as askHostScreen, type HostScreen } from "../../../../shared/lib/hostScreen";
import { useT } from "../../../../shared/i18n";
import type { ProfileForm } from "../../../../entities/profile";
import type { FieldProps } from "./types";

// The monitor this launcher is on, in CSS pixels. Null while it is being asked
// and on a machine with none, and the editor then offers every resolution.
function useHostScreen(): HostScreen | null {
  const [size, setSize] = useState<HostScreen | null>(null);
  useEffect(() => { void askHostScreen().then(setSize); }, []);
  return size;
}

/** The "This computer's screen" choice's value. */
const HOST = "host";

/// The screen sizes a profile can claim here (Windows and Linux; macOS keeps
/// the profile's own, so there is nothing to choose): what this monitor can
/// show, and the stored size even when it is larger, never a placeholder that
/// would read as "not set" (CRAFT-21). The profile form's Screen field uses it.
/// A new profile (no id yet) also gets "This computer's screen", its default.
export function useScreenChoice(f: ProfileForm, u: FieldProps["u"], os: string) {
  const t = useT();
  const hostScreen = useHostScreen();
  const size = f.screen_w > 0 ? `${f.screen_w}x${f.screen_h}` : "";
  const current = f.screen_host ? HOST : size;
  // The size the form holds once chosen, else the monitor's.
  const host = f.screen_host && f.screen_w > 0 ? [f.screen_w, f.screen_h] as const : hostScreen;
  const offerHost = !!host && (f.screen_host || !f.id);
  // Offered: only what this monitor can show (a larger claim is contradicted
  // by the window itself), and the stored size.
  const values = useMemo(() => {
    const fits = SCREEN_RESOLUTIONS.filter(
      ([w, h]) => !hostScreen || (w <= hostScreen[0] && h <= hostScreen[1]),
    );
    const list = [...(offerHost ? [HOST] : []), "", ...fits.map(([w, h]) => `${w}x${h}`)];
    if (current && !list.includes(current)) list.push(current);
    return list;
  }, [hostScreen, current, offerHost]);
  const larger = !f.screen_host && !!size && !!hostScreen && (f.screen_w > hostScreen[0] || f.screen_h > hostScreen[1]);
  const label = (v: string) =>
    v === HOST ? t("inlineEditor.resolutionHost", { size: host ? `${host[0]} × ${host[1]}` : "" })
    : !v ? t("inlineEditor.resolutionTemplate")
    : v === size && larger ? t("inlineEditor.resolutionLarger", { size: v.replace("x", " × ") })
    : v.replace("x", " × ");
  return {
    shown: os === "Windows" || os === "Linux",
    value: current,
    options: optionsOf(values, label),
    set: (v: string) => {
      const [w, h] = v === HOST ? (host ?? [0, 0]) : v ? v.split("x").map(Number) : [0, 0];
      u("screen_w", w);
      u("screen_h", h);
      // Only a size picked here counts as chosen by hand.
      u("screen_custom", v !== HOST && w > 0 && h > 0);
      u("screen_dpr", v !== HOST ? 0 : f.screen_host && f.screen_w > 0 ? f.screen_dpr : hostScreen?.[2] ?? 0);
      u("screen_host", v === HOST && w > 0 && h > 0);
    },
    help: hostScreen ? t("inlineEditor.resolutionHelp", { w: hostScreen[0], h: hostScreen[1] }) : t("inlineEditor.resolutionHelpNoHost"),
    larger,
  };
}

/// The profile form's Screen resolution field, from `useScreenChoice`.
export function ScreenField({ f, u, os }: FieldProps & { os: string }) {
  const t = useT();
  const screen = useScreenChoice(f, u, os);
  if (!screen.shown) return null;
  return (
    <>
      <SelectField label={t("inlineEditor.resolutionLabel")} value={screen.value} onChange={screen.set} options={screen.options} />
      <p className="m-0 -mt-2 flex items-center gap-1.5 text-secondary text-text-soft-400">
        {/* The shared dot (owner 5i, superseding P16): never a bare color,
            always next to the word — here the button's own text already
            says "larger than this screen"; the dot is the same warning look
            the Proxy field uses, not a hand-made one. */}
        {screen.larger && <StatusDot tone="warning" />}
        {screen.help}
      </p>
    </>
  );
}

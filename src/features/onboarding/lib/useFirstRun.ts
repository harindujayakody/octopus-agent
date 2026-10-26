import { useEffect } from "react";
import { useProfile } from "../../../entities/profile";
import { trashList } from "../../../entities/trash";
import { useOnboarding } from "../model/onboarding";

/// Whether this is a fresh install, read from the data: the first loaded
/// list decides (profiles in the Trash still mean the user has been here,
/// PC-115), and the first profile puts the setup away for good. The welcome
/// reads it (`wantsWelcome`).
export function useFirstRun(): void {
  const status = useProfile((s) => s.status);
  const count = useProfile((s) => s.profiles.length);
  const state = useOnboarding((s) => s.state);

  useEffect(() => {
    if (status !== "ready" || useOnboarding.getState().state !== "unknown") return;
    if (count > 0) { useOnboarding.getState().decide(true); return; }
    trashList().then((l) => useOnboarding.getState().decide(l.length > 0), () => useOnboarding.getState().decide(false));
  }, [status, count]);
  useEffect(() => {
    if (state === "active" && count > 0) useOnboarding.getState().finish();
  }, [state, count]);
}

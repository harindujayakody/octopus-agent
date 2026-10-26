import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { useNav } from "../../../shared/model/navigation";
import { useProfile } from "../../../entities/profile";
import { startProfileTour } from "../lib/profileTour";
import { useOnboarding } from "../../onboarding/model/onboarding";
import { useTour } from "../model/useTour";

/** The tour's card fades out in 150 ms; the end card comes after it, so the
 *  two never share the screen and the tour's focus return is long done. */
const AFTER_TOUR_MS = 200;

/**
 * What follows a full tour, mounted once in the shell. It writes the end
 * into the onboarding record (a finished tour is "done", a skipped, Esc'd or
 * cancelled one "skipped", and every page the run showed counts as seen), and
 * a finished tour then opens "You're all set." with the first profile one
 * press away (it opens the New profile form and walks it). Page runs (a tip,
 * "Show me around") are not its business.
 */
export function TourEndCard() {
  const t = useT();
  const ended = useTour((s) => s.ended);
  const hasProfiles = useProfile((s) => s.profiles.length > 0);
  const [open, setOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ended || ended.kind !== "full") return;
    const onboarding = useOnboarding.getState();
    for (const section of ended.visited) onboarding.markPageSeen(section);
    onboarding.setTour(ended.reason === "done" ? "done" : "skipped");
  }, [ended]);

  useEffect(() => {
    if (!ended || ended.kind !== "full" || ended.reason !== "done") return;
    const timer = window.setTimeout(() => setOpen(true), AFTER_TOUR_MS);
    return () => window.clearTimeout(timer);
  }, [ended]);

  // Create opens the form on the Profiles page, where the new profile will
  // be, and walks it: the first profile is what the tour was for.
  const create = () => {
    setOpen(false);
    void startProfileTour();
  };

  // Done (Esc and a press outside mean it too) goes to Profiles, where the
  // list is, not the last page the tour showed.
  // Through the unsaved-changes guard; the keyboard goes with it.
  const done = () => {
    setOpen(false);
    void useNav.getState().setSection("profiles", { focus: true });
  };

  const createButton = (primary: boolean) => (
    <Button ref={createRef} size="xsmall" variant={primary ? "primary" : "neutral"} mode={primary ? "filled" : "stroke"} data-primary={primary ? "" : undefined} onClick={create}>
      {hasProfiles ? t("commands.newProfile") : t("tour.end.createFirst")}
    </Button>
  );
  const doneButton = (primary: boolean) => (
    <Button ref={doneRef} size="xsmall" variant={primary ? "primary" : "neutral"} mode={primary ? "filled" : "stroke"} data-primary={primary ? "" : undefined} onClick={done}>
      {t("tour.end.done")}
    </Button>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) done(); }}
      size="sm"
      showClose={false}
      title={t("tour.end.title")}
      description={t("tour.end.body")}
      initialFocusRef={hasProfiles ? doneRef : createRef}
      footer={hasProfiles ? <>{createButton(false)}{doneButton(true)}</> : <>{doneButton(false)}{createButton(true)}</>}
    />
  );
}

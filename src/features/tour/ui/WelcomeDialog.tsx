import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button, Modal, cn } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { announce } from "../../../shared/model/announce";
import { toast } from "../../../shared/model/toast";
import { useProfile } from "../../../entities/profile";
import { useOnboarding, useShouldWelcome } from "../../onboarding/model/onboarding";
import { useTour } from "../model/useTour";
import { fullTour } from "../steps/fullTour";
import { HIT } from "./TourCard";
import { WelcomePicture, type WelcomePictureId } from "./WelcomePictures";

const SCREENS: readonly WelcomePictureId[] = ["profiles", "proxies", "tour"];

/** A block of a screen, coming in `i` places after the screen's first (the stagger). */
const place = (i: number) => ({ "--welcome-i": i }) as CSSProperties;

/**
 * The welcome (onboarding spec 4), mounted once in the shell: three screens
 * on a first install, once the engine gate is behind it and the profile list
 * has loaded. Skip is on every screen (so are Esc and a press outside, which
 * mean the same); Start tour on the last begins the full tour. Either answer
 * is kept, so it never opens again.
 */
export function WelcomeDialog() {
  const t = useT();
  const wanted = useShouldWelcome();
  const listReady = useProfile((s) => s.status === "ready");
  // Latched: once it has opened it stays up until it is answered, whatever
  // the profile list does meanwhile (a reload).
  const [shown, setShown] = useState(false);
  useEffect(() => { if (wanted && listReady) setShown(true); }, [wanted, listReady]);
  const open = shown && wanted;

  const [index, setIndex] = useState(0);
  const total = SCREENS.length;
  const last = index === total - 1;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

  const screens = [
    { title: t("welcome.profiles.title"), body: t("welcome.profiles.body") },
    { title: t("welcome.proxies.title"), body: t("welcome.proxies.body") },
    { title: t("welcome.tour.title"), body: t("welcome.tour.body") },
  ];
  const screen = screens[index];

  const go = (to: number) => {
    setIndex(to);
    announce(t("welcome.screenAnnounce", { n: to + 1, total, title: screens[to].title }));
  };
  // Put away: the welcome never comes back, and neither does the tour offer.
  // Esc and a press outside land here too, so the toast says where the tour
  // is kept (the same words as the tour's own Esc).
  const skip = () => {
    const onboarding = useOnboarding.getState();
    onboarding.setWelcomeDone();
    onboarding.setTour("skipped");
    toast.info(t("tour.replayHint"));
  };
  // Answered: the tour begins as the welcome leaves (the tour's end records how it went).
  const startTour = () => {
    useOnboarding.getState().setWelcomeDone();
    useTour.getState().start(fullTour, "full");
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) skip(); }}
      size="md"
      showClose={false}
      aria-label={t("welcome.label")}
      initialFocusRef={primaryRef}
      footer={
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
          <span className="justify-self-start">
            <Button variant="neutral" mode="ghost" size="xsmall" className={HIT} onClick={skip}>
              {t("welcome.skip")}
            </Button>
          </span>
          <span data-welcome-dots className="flex items-center gap-2">
            {/* The words for a screen reader; the dots are only for the eye. */}
            <span data-welcome-count className="sr-only">{t("welcome.screenCount", { n: index + 1, total })}</span>
            {SCREENS.map((id, i) => (
              <span key={id} aria-hidden="true" className={cn("size-[6px] rounded-full", i === index ? "bg-primary-base" : "bg-bg-sub-300")} />
            ))}
          </span>
          <span className="flex items-center gap-3 justify-self-end">
            {index > 0 && (
              <Button variant="neutral" mode="stroke" size="xsmall" className={HIT} onClick={() => go(index - 1)}>
                {t("tour.back")}
              </Button>
            )}
            {/* One button for both: the keyboard stays on it from Next to Start tour. */}
            <Button ref={primaryRef} variant="primary" size="xsmall" className={HIT} onClick={last ? startTour : () => go(index + 1)}>
              {last ? t("welcome.start") : t("tour.next")}
            </Button>
          </span>
        </div>
      }
    >
      {/* Keyed by the screen: each one's blocks come in again, 50 ms apart. */}
      <div
        key={index}
        data-welcome-screen={SCREENS[index]}
        className="flex flex-col gap-3"
        // The dialog is named by its label only, and the kit's Modal takes a
        // description just as visible text: so the body is linked here, and
        // the first screen is read as the dialog opens.
        ref={(el) => el?.closest('[role="dialog"]')?.setAttribute("aria-describedby", bodyId)}
      >
        <div className="welcome-in" style={place(0)}>
          <WelcomePicture id={SCREENS[index]} />
        </div>
        <h2 className="welcome-in m-0 text-panel-title text-text-strong-950" style={place(1)}>{screen.title}</h2>
        <p id={bodyId} className="welcome-in m-0 min-h-[2lh] text-body text-text-sub-600" style={place(2)}>{screen.body}</p>
      </div>
    </Modal>
  );
}

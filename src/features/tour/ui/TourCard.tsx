import { useId, type CSSProperties, type RefObject } from "react";
import { Button, cn, type Side } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import type { TourPage } from "../lib/pageName";
import type { TourRun, TourStep } from "../model/types";
import type { Section } from "../../../shared/types";
import { TourPicture } from "./TourPicture";

/** 30 px buttons with a 40 by 40 px hit area (onboarding spec 5.3): 5 px
 *  out on every side, and 10 px between buttons so no two overlap. */
export const HIT = "before:absolute before:-inset-[5px] before:content-['']";

/** Where the arrow sits: the card's side next to the element, and how far
 *  along that edge (px from the card's start) the element's middle is. */
export type TourArrow = { side: Side; at: number };

/** The arrow's place for each side the card sits on: it points back at the element. */
function arrowStyle({ side, at }: TourArrow): CSSProperties {
  switch (side) {
    case "bottom": return { top: -8, left: at - 8 };
    case "top": return { bottom: -8, left: at - 8, rotate: "180deg" };
    case "right": return { left: -12, top: at - 4, rotate: "-90deg" };
    case "left": return { right: -12, top: at - 4, rotate: "90deg" };
  }
}

/** The page's icon in its 14 px slot. */
function PageIcon({ page }: { page: TourPage }) {
  return (
    <span data-tour-page-icon aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center text-icon-soft-400">
      {page.Icon && <page.Icon className="size-3.5" />}
    </span>
  );
}

/**
 * One step's card: the page it is on (a quiet line with the page's icon and
 * name), its title, one or two sentences, "3 of 18", Skip tour, Back and Next
 * (Finish on the last). While a page change shows which page it moved to (the
 * beat), the card is just that page's icon and name and a short line. A page's tip (one nobody asked for)
 * says just "Skip" and adds a small "Don't show tips" link under the
 * buttons; a "Show me around" does neither. A dialog named by its title
 * and described by its text. The layer places it and runs its motion.
 */
export function TourCard({
  step,
  kind,
  index,
  total,
  page,
  beat,
  arrow,
  showPicture,
  cardRef,
  nextRef,
  style,
  className,
  entering,
  input,
  onBack,
  onNext,
  onSkip,
  onTipsOff,
}: {
  step: TourStep;
  kind: TourRun["kind"];
  index: number;
  total: number;
  /** The page the card is about: the step's, or the one the beat shows. */
  page: TourPage;
  /** The page the beat shows; null for a step's card. */
  beat: Section | null;
  arrow: TourArrow | null;
  showPicture: boolean;
  cardRef: RefObject<HTMLDivElement | null>;
  nextRef: RefObject<HTMLButtonElement | null>;
  style: CSSProperties;
  className: string;
  entering: boolean;
  input: string;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  /** Turns every page tip off and ends the run. */
  onTipsOff: () => void;
}) {
  const t = useT();
  const id = useId();
  const last = index === total - 1;
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      tabIndex={-1}
      data-tour-card
      data-step={beat ? undefined : step.id}
      data-beat={beat ?? undefined}
      data-entering={entering || undefined}
      data-input={input}
      style={style}
      className={cn(
        "pointer-events-auto flex w-[320px] flex-col gap-2 rounded-surface bg-bg-popover p-3 shadow-(--shadow-float) white-surface forced-edge focus-visible:outline-hidden",
        className,
      )}
    >
      {arrow && (
        <svg data-tour-arrow aria-hidden="true" width="16" height="8" viewBox="0 0 16 8" className="absolute fill-bg-popover" style={arrowStyle(arrow)}>
          <path d="M0 8 8 0 16 8Z" />
        </svg>
      )}
      {beat ? (
        <>
          <div className="flex items-center gap-2">
            <PageIcon page={page} />
            <h2 id={`${id}-title`} className="m-0 min-w-0 flex-1 truncate text-section-title text-text-strong-950">{page.name}</h2>
          </div>
          <p id={`${id}-body`} className="m-0 text-body text-text-sub-600">{t("tour.beat.opening", { page: page.name })}</p>
        </>
      ) : (
        <>
          {/* The part of the app the step is about, drawn small, while it is not on screen. */}
          {showPicture && step.picture && <TourPicture id={step.picture} />}
          <div className="flex flex-col gap-0.5">
            {page.name && (
              <div data-tour-page className="flex min-w-0 items-center gap-1.5 text-secondary text-text-sub-600">
                <PageIcon page={page} />
                <span className="min-w-0 truncate">{page.name}</span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <h2 id={`${id}-title`} className="m-0 min-w-0 flex-1 text-section-title text-text-strong-950">{t(step.title)}</h2>
              <span className="shrink-0 text-secondary text-text-sub-600 tabular-nums">{t("tour.count", { n: index + 1, total })}</span>
            </div>
          </div>
          <p id={`${id}-body`} className="m-0 text-body text-text-sub-600">{t(step.body)}</p>
          <div className="mt-1 flex items-center gap-3">
            <Button variant="neutral" mode="ghost" size="xsmall" className={HIT} onClick={onSkip}>
              {kind === "page" ? t("tour.skipTip") : t("tour.skip")}
            </Button>
            <span className="ms-auto flex items-center gap-3">
              {index > 0 && (
                <Button variant="neutral" mode="stroke" size="xsmall" className={HIT} onClick={onBack}>
                  {t("tour.back")}
                </Button>
              )}
              <Button ref={nextRef} variant="primary" size="xsmall" className={HIT} onClick={onNext}>
                {last ? t("tour.finish") : t("tour.next")}
              </Button>
            </span>
          </div>
          {kind === "page" && (
            // The kit's link button is as tall as its text line (`h-auto`, and the
            // kit's `cn` only joins classes, so a plain height would lose to it):
            // `h-[30px]!` gives it the other buttons' 30 px, so HIT reaches 40. Its
            // text and underline stay where they were. The card's 7 px gap and this
            // 3 px margin make 10 px: its hit area and the buttons' above it meet
            // and do not overlap.
            <div className="mt-1">
              <Button variant="neutral" mode="link" size="xsmall" className={cn(HIT, "h-[30px]!")} onClick={onTipsOff}>
                {t("tour.tipsOff")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

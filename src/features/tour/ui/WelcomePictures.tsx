import type { ReactNode } from "react";
import { Button, cn } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { MoveRightIcon, NavFingerprintsIcon, NavProxiesIcon } from "../../../shared/icons";
import { fullTour } from "../steps/fullTour";
import { Bar, Surface } from "./TourPicture";

/// The welcome's three pictures, made of the app's own parts as the tour's
/// are (TourPicture): neutral surfaces, grey bars for text, the real buttons
/// with their real words. Quiet on purpose: they say what the screen says
/// and carry nothing else. Inert and hidden from screen readers.

export type WelcomePictureId = "profiles" | "proxies" | "tour";

/** One profile: a small browser window with its own name and look. */
function Window({ tint, name, lines }: { tint: string; name: string; lines: [string, string] }) {
  return (
    <Surface className="w-[104px] shrink-0 flex-col gap-1.5 p-2 shadow-(--shadow-xs)">
      <span className="flex gap-1">
        <span className="size-[4px] rounded-full bg-bg-sub-300" />
        <span className="size-[4px] rounded-full bg-bg-sub-300" />
        <span className="size-[4px] rounded-full bg-bg-sub-300" />
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-[10px] shrink-0 rounded-full", tint)} />
        <Bar w={name} strong />
      </span>
      <Bar w={lines[0]} />
      <Bar w={lines[1]} />
    </Surface>
  );
}

/** Three profiles side by side: each its own window, none sharing anything. */
function ProfilesPicture() {
  return (
    <>
      <Window tint="bg-primary-tint" name="46%" lines={["82%", "58%"]} />
      <Window tint="bg-bg-soft-200" name="38%" lines={["70%", "76%"]} />
      <Window tint="bg-bg-sub-300" name="52%" lines={["64%", "48%"]} />
    </>
  );
}

/** A labelled part of a profile: its icon, its word, and a few lines of detail. */
function Part({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Surface className="w-[104px] shrink-0 flex-col gap-1.5 p-2 shadow-(--shadow-xs)">
      <span className="flex items-center gap-1.5 text-secondary text-text-sub-600">
        <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {children}
    </Surface>
  );
}

/** A proxy and a fingerprint, and the profile window they make. */
function ProxiesPicture() {
  const t = useT();
  return (
    <>
      <Part icon={<NavProxiesIcon className="size-3.5" />} label={t("peek.proxy")}>
        <Bar w="78%" strong />
        <Bar w="52%" />
      </Part>
      <Part icon={<NavFingerprintsIcon className="size-3.5" />} label={t("peek.fingerprint")}>
        <Bar w="68%" strong />
        <Bar w="84%" />
      </Part>
      <MoveRightIcon className="size-3.5 shrink-0 text-icon-sub-600" />
      <Window tint="bg-primary-tint" name="44%" lines={["72%", "56%"]} />
    </>
  );
}

/** The page dimmed with one part lit, and the card that explains it. */
function TourOfferPicture() {
  const t = useT();
  return (
    <>
      <span className="relative flex h-[88px] w-[132px] shrink-0 items-center justify-center overflow-hidden rounded-control bg-bg-popover">
        <span className="absolute inset-0 bg-(--tour-scrim)" />
        <Surface className="relative h-[30px] w-[80px] items-center justify-center shadow-(--shadow-xs)">
          <Bar w="56%" strong />
        </Surface>
      </span>
      <Surface className="w-[156px] shrink-0 flex-col gap-2 p-2 shadow-(--shadow-xs)">
        <span className="flex items-center justify-between gap-2">
          <Bar w="42%" strong />
          <span className="text-micro text-text-sub-600 tabular-nums">{t("tour.count", { n: 3, total: fullTour.length })}</span>
        </span>
        <Bar w="90%" />
        <Bar w="64%" />
        <span className="ms-auto">
          <Button variant="primary" size="3xsmall" static tabIndex={-1}>{t("tour.next")}</Button>
        </span>
      </Surface>
    </>
  );
}

const PICTURES: Record<WelcomePictureId, () => ReactNode> = {
  profiles: ProfilesPicture,
  proxies: ProxiesPicture,
  tour: TourOfferPicture,
};

export function WelcomePicture({ id }: { id: WelcomePictureId }) {
  const Picture = PICTURES[id];
  return (
    <div
      data-welcome-picture={id}
      aria-hidden="true"
      inert
      className="flex h-[132px] items-center justify-center gap-3 overflow-hidden rounded-control bg-bg-weak-50 px-3"
    >
      <Picture />
    </div>
  );
}

import type { ReactNode } from "react";
import { Button, Checkbox, cn } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { MoveRightIcon, PlayIcon } from "../../../shared/icons";
import type { TourPictureId } from "../model/types";

/// A small drawing of a part of the app, for a step whose real part is not on
/// screen (no profiles: no list, no Start button, no Filters; no project
/// open: no editor). Built
/// from the kit's own parts and neutral surfaces, so it reads as the app and
/// not as stock art: grey bars stand for text, the buttons are the real
/// buttons with their real words. It is a picture only: inert, hidden from
/// screen readers (the step's text says it all), and quiet.

/** A grey line standing for a word or two. */
export function Bar({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className={cn("block h-[6px] shrink-0 rounded-full", strong ? "bg-bg-sub-300" : "bg-bg-soft-200")} style={{ width: w }} />;
}

/** A raised surface on the picture's ground: a row, a panel, a window. */
export function Surface({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("flex rounded-control bg-bg-popover", className)}>{children}</div>;
}

/** The rows of the little list: the picked one is the profile whose details show. */
const LIST_ROWS = [{ w: "70%", picked: false }, { w: "55%", picked: true }, { w: "62%", picked: false }, { w: "48%", picked: false }];

/** The profile list on the left and its details panel pushing in from the right. */
function PanelPicture() {
  const t = useT();
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {LIST_ROWS.map(({ w, picked }) => (
          <div key={w} className={cn("flex h-[20px] items-center rounded-control px-2", picked && "bg-bg-selected")}>
            <Bar w={w} strong={picked} />
          </div>
        ))}
      </div>
      <Surface className="w-[56%] shrink-0 flex-col gap-2 p-2 shadow-(--shadow-xs)">
        <div className="flex items-center justify-between gap-2">
          <Bar w="42%" strong />
          <Button variant="neutral" mode="stroke" size="3xsmall" static tabIndex={-1}>{t("peek.edit")}</Button>
        </div>
        <Bar w="85%" />
        <Bar w="70%" />
        <Bar w="78%" />
      </Surface>
    </>
  );
}

/** A profile row with its Start button, and the browser window Start opens. */
function StartButtonPicture() {
  const t = useT();
  return (
    <div className="flex flex-1 items-center gap-2">
      <Surface className="h-[32px] min-w-0 flex-1 items-center justify-between gap-2 px-2">
        <Bar w="38%" strong />
        <Button variant="primary" mode="lighter" size="3xsmall" static tabIndex={-1} leftIcon={<PlayIcon className="size-3.5" />} className="min-w-[76px]">
          {t("commands.start")}
        </Button>
      </Surface>
      <MoveRightIcon className="size-3.5 shrink-0 text-icon-sub-600" />
      <Surface className="w-[84px] shrink-0 flex-col gap-1.5 p-1.5 shadow-(--shadow-xs)">
        <span className="flex gap-1">
          <span className="size-[4px] rounded-full bg-bg-sub-300" />
          <span className="size-[4px] rounded-full bg-bg-sub-300" />
          <span className="size-[4px] rounded-full bg-bg-sub-300" />
        </span>
        <Bar w="80%" strong />
        <Bar w="60%" />
        <Bar w="70%" />
      </Surface>
    </div>
  );
}

/** The editor's header with Save and Run, and the steps under it. */
function AutomationEditorPicture() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <Surface className="h-[28px] items-center gap-1.5 px-2">
        <Bar w="30%" strong />
        <span className="ms-auto flex items-center gap-1.5">
          <Button variant="neutral" mode="stroke" size="3xsmall" static tabIndex={-1}>{t("unsaved.save")}</Button>
          <Button variant="primary" mode="filled" size="3xsmall" static tabIndex={-1} leftIcon={<PlayIcon className="size-3.5" />}>
            {t("projectEditor.run")}
          </Button>
        </span>
      </Surface>
      {["64%", "46%", "56%"].map((w) => (
        <Surface key={w} className="h-[18px] items-center gap-2 px-2">
          <span className="size-[8px] shrink-0 rounded-full bg-bg-soft-200" />
          <Bar w={w} />
        </Surface>
      ))}
    </div>
  );
}

/** The list's column titles are its real ones; its rows are grey bars. */
const LIST_COLUMNS = ["profileTable.colName", "profileTable.colProxy", "profileTable.colLastRun"] as const;
const LIST_BARS = [["72%", "58%", "40%"], ["54%", "70%", "48%"], ["64%", "46%", "56%"]];
const GRID = "grid grid-cols-[1.3fr_1fr_0.8fr] items-center gap-3 px-2";

/** The profile list: its column titles and a few rows. */
function ProfileListPicture() {
  const t = useT();
  return (
    <Surface className="flex-1 flex-col gap-1 py-2">
      <div className={cn(GRID, "h-[18px] text-secondary text-text-soft-400")}>
        {LIST_COLUMNS.map((key) => <span key={key} className="min-w-0 truncate">{t(key)}</span>)}
      </div>
      {LIST_BARS.map((bars) => (
        <div key={bars[0]} className={cn(GRID, "h-[20px]")}>
          {bars.map((w, i) => <Bar key={i} w={w} strong={i === 0} />)}
        </div>
      ))}
    </Surface>
  );
}

/** The columns a Display list offers: the first two ticked. */
const COLUMN_CHOICES = [{ w: "52%", on: true }, { w: "40%", on: true }, { w: "60%", on: false }];

/** The Filters and Display buttons, and what Display opens under it. */
function FiltersPicture() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="ms-auto flex items-center gap-1.5">
        <Button variant="neutral" mode="stroke" size="3xsmall" static tabIndex={-1}>{t("profileFilterBar.filters")}</Button>
        <Button variant="neutral" mode="stroke" size="3xsmall" static tabIndex={-1}>{t("profileDisplay.title")}</Button>
      </span>
      <Surface className="ms-auto w-[58%] flex-col gap-0.5 px-2 py-1.5 shadow-(--shadow-xs)">
        {COLUMN_CHOICES.map(({ w, on }) => (
          <span key={w} className="flex h-[20px] items-center gap-2">
            <Checkbox checked={on} onChange={() => undefined} tabIndex={-1} hitArea={false} />
            <Bar w={w} />
          </span>
        ))}
      </Surface>
    </div>
  );
}

const PICTURES: Record<TourPictureId, () => ReactNode> = {
  panel: PanelPicture,
  startButton: StartButtonPicture,
  automationEditor: AutomationEditorPicture,
  profileList: ProfileListPicture,
  filters: FiltersPicture,
};

export function TourPicture({ id }: { id: TourPictureId }) {
  const Picture = PICTURES[id];
  return (
    <div
      data-tour-picture={id}
      aria-hidden="true"
      inert
      className="flex shrink-0 gap-2 rounded-control bg-bg-weak-50 p-2"
    >
      <Picture />
    </div>
  );
}

import { useRef, useState } from "react";
import { Button, IconButton, Popover } from "@proxyshard/shardx-ui-kit";
import { InfoIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";

/** What a page's (i) button says: a title, two or three sentences on what the
 *  page is for and what you do there, and (once Part 3's tour exists) the tour
 *  that walks through it. */
export type PageHelp = {
  title: string;
  body: string;
  /** Shows a "Show me around" button; the page that has a tour passes it. */
  onTour?: () => void;
};

/// The (i) beside a page's title (clarity fixes, item 7). A click, Enter or
/// Space opens a popover under it that says what the page is for. It used to
/// be a tooltip only, which the press itself dismissed. Esc, a press outside
/// or the button again closes it, and focus goes back to the button. The
/// popover grows from the button (the kit Popover's own origin).
export function PageHelpButton({ help }: { help: PageHelp }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        size="3xsmall"
        label={t("pageHelp.button")}
        icon={<InfoIcon className="size-3.5" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          // A press does not focus a button in every webview (Safari's), and
          // the popover hands focus back to what had it when it opened.
          e.currentTarget.focus();
          setOpen((v) => !v);
        }}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={trigger}
        side="bottom"
        align="start"
        aria-label={help.title}
        className="flex w-[300px] flex-col items-start gap-2 p-3"
      >
        <h2 className="m-0 text-section-title text-text-strong-950">{help.title}</h2>
        <p className="m-0 text-body text-text-sub-600">{help.body}</p>
        {help.onTour && (
          <Button
            variant="neutral"
            mode="stroke"
            size="xsmall"
            className="mt-1"
            onClick={() => { setOpen(false); help.onTour?.(); }}
          >
            {t("pageHelp.tour")}
          </Button>
        )}
      </Popover>
    </>
  );
}

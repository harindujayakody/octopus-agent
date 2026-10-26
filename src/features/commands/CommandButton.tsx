import type { RefObject } from "react";
import { Button, Tooltip, type ButtonProps } from "@proxyshard/shardx-ui-kit";
import type { Command, Subject, Surface } from "../../shared/commands";
import { ariaOf, capOf, iconOf, reasonOf, runCommand } from "./surfaces";

type CommandButtonProps = {
  command: Command;
  subject: Subject;
  from: Surface;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** The bar is narrow: the button folds to its icon, its label in the
   *  tooltip, unless it runs something or is dangerous (Start, Stop, Test,
   *  Move to Trash and Delete keep their words at every width, LAYOUT-02). */
  narrow?: boolean;
  /** Each run as it starts, for a bar that holds a button until its run ends. */
  onRun?: (run: Promise<void>) => void;
} & Omit<ButtonProps, "onClick" | "children" | "leftIcon" | "onlyIcon" | "aria-label">;

/// A registry command as a bar button: its icon and label, its key in the
/// tooltip, disabled with the reason as the tooltip when it cannot run now
/// (ruling 3: a bar keeps its shape). A caller's `disabled` holds it with no
/// reason (a run still in progress).
export function CommandButton({
  command: c, subject, from, buttonRef, narrow = false, onRun, disabled = false, ...rest
}: CommandButtonProps) {
  const label = c.label(subject.ids.length);
  const iconOnly = narrow && c.group !== "run" && !c.danger;
  const reason = reasonOf(c, subject);
  return (
    <Tooltip content={reason ?? label} shortcut={reason ? undefined : capOf(c)}>
      <Button
        ref={buttonRef}
        data-command={c.id}
        variant={c.danger ? "error" : "neutral"}
        mode="ghost"
        size="3xsmall"
        // Named by its label, so the tooltip that repeats it adds no description (A11Y-09).
        aria-label={label}
        aria-keyshortcuts={ariaOf(c)}
        leftIcon={iconOf(c)}
        onlyIcon={iconOnly}
        disabled={reason !== null || disabled}
        onClick={() => {
          const run = runCommand(c, subject, { from });
          onRun?.(run);
        }}
        {...rest}
      >
        {iconOnly ? null : label}
      </Button>
    </Tooltip>
  );
}

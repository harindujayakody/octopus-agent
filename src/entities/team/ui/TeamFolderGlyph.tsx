import { cn } from "@proxyshard/shardx-ui-kit";
import { FolderIcon } from "../../../shared/icons";
import { labelColor } from "../../../shared/constants";

/** A team folder's icon in its color; a folder with none is the soft gray. */
export function TeamFolderGlyph({ color }: { color: string }) {
  const css = labelColor(color);
  return <FolderIcon aria-hidden="true" className={cn("size-3.5 shrink-0", !css && "text-icon-soft-400")} style={css ? { color: css } : undefined} />;
}

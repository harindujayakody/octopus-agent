import { useMemo } from "react";
import { IconButton, Input, Tooltip } from "@proxyshard/shardx-ui-kit";
import { TAG_NAME_MAX, useTags, type Tag } from "../../../entities/tag";
import { deferDelete } from "../../../shared/lib/deferDelete";
import { focusAfterRowDelete } from "../rowDelete";
import { DeleteIcon } from "../../../shared/icons";
import { ColorRadios } from "../../../shared/ui/ColorRadios";
import { useT } from "../../../shared/i18n";
import { SettingsGroup } from "../SettingRow";
import { queueTagOp, usePendingTag } from "../useSettingsDraft";
import { teamRefusal, useRightsChange } from "../../../entities/space";

/// Every tag, to rename, recolor or delete. A rename or a color waits for
/// Save with the rest of the page (manual save); a delete runs at once,
/// behind its Undo.
export function TagsSection() {
  const t = useT();
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  // Profiles in the Trash count too: they keep their tags, and lose them on delete.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const ids of Object.values(byProfile)) for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
    return out;
  }, [byProfile]);

  return (
    // An empty list is one centered line, with no help above it (owner rule).
    <SettingsGroup list help={tags.length > 0 ? t("settings.tagsHelp") : undefined}>
      {tags.length === 0 ? (
        <p className="m-0 py-6 text-center text-body text-balance text-text-sub-600">{t("settings.tagsEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tags.map((tag) => <TagRow key={tag.id} tag={tag} count={counts.get(tag.id) ?? 0} />)}
        </ul>
      )}
    </SettingsGroup>
  );
}

function TagRow({ tag, count }: { tag: Tag; count: number }) {
  const t = useT();
  const remove = useTags((s) => s.remove);
  // What the page shows: the waiting rename and color over the saved ones.
  const { name, color, error } = usePendingTag(tag);
  const rename = (to: string) => queueTagOp({ kind: "rename", id: tag.id, name: to });
  // A team's tags: changing one needs Edit in the team, deleting one Delete.
  useRightsChange();
  const noEdit = teamRefusal("edit");
  const noDelete = teamRefusal("delete");

  // Behind an Undo toast, nothing asked (ruling 18). The hide deletes it in
  // the backend at once, so there is nothing more to run.
  // Undo puts it back where it was, on the profiles it was on. The keyboard
  // goes to the next row's Delete, read before the row leaves (A11Y-04).
  const del = (button: HTMLElement) => {
    if (noDelete) return;
    const { tags, byProfile } = useTags.getState();
    const at = tags.findIndex((x) => x.id === tag.id);
    const next = focusAfterRowDelete(button);
    deferDelete({
      key: `tag:${tag.id}`,
      title: t("settings.tagDeleted", { name: tag.name }),
      detail: count === 0 ? undefined : count === 1 ? t("settings.tagsDeleteOne") : t("settings.tagsDeleteMany", { n: count }),
      failTitle: t("settings.tagDeleteFailed", { name: tag.name }),
      hide: () => remove(tag.id),
      restore: () => useTags.getState().restoreTag(tag, byProfile, at < 0 ? undefined : at),
      commit: async () => {},
    });
    next();
  };

  return (
    <li data-tag-row={tag.id} className="row-line relative flex items-center gap-4 px-cell py-3">
      {/* Without Edit in the team the name and colour are shown, not changed, and say why. */}
      <Tooltip content={noEdit ?? undefined}>
      <div className="w-[200px] shrink-0">
        <Input
          aria-label={t("settings.tagNameFor", { name: tag.name })}
          inputSize="xsmall"
          value={name}
          disabled={!!noEdit}
          aria-description={noEdit ?? undefined}
          maxLength={TAG_NAME_MAX}
          error={error}
          onChange={(e) => rename(e.target.value)}
          // An empty name is no name: leaving the field keeps the one it had.
          onBlur={() => { if (!name.trim()) rename(tag.name); }}
          onKeyDown={(e) => {
            // An Esc that cancels an input method's text is its own.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") rename(tag.name);
          }}
        />
      </div>
      </Tooltip>
      <fieldset disabled={!!noEdit} className="m-0 min-w-0 border-0 p-0">
        <ColorRadios
          label={t("settings.tagColor", { name: tag.name })}
          value={color}
          onChange={(c) => { if (c && !noEdit) queueTagOp({ kind: "recolor", id: tag.id, color: c }); }}
        />
      </fieldset>
      <span className="ml-auto whitespace-nowrap text-secondary tabular-nums text-text-soft-400">
        {count === 0 ? t("settings.tagsCountNone") : count === 1 ? t("settings.tagsCountOne") : t("settings.tagsCountMany", { n: count })}
      </span>
      <IconButton
        data-row-delete
        size="2xsmall"
        icon={<DeleteIcon className="size-3.5" />}
        label={noDelete ? t("rights.labelWhy", { label: t("settings.tagDelete", { name: tag.name }), why: noDelete }) : t("settings.tagDelete", { name: tag.name })}
        disabled={!!noDelete}
        onClick={(e) => del(e.currentTarget)}
      />
    </li>
  );
}

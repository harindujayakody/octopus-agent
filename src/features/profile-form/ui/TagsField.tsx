import { useMemo, useRef, useState } from "react";
import { Combobox, Popover, type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { TagChip } from "../../../shared/ui/TagChip";
import { PropertyButton, PropertyRow } from "../../../shared/ui/peek";
import { useT } from "../../../shared/i18n";
import { nextTagColor, TAG_NAME_MAX, useTags, type Tag } from "../../../entities/tag";

/** A name the form keeps as a tag until Save: its option's value. */
const NEW = "new:";

/// The profile form's Tags: the tag picker's list, but nothing is written
/// here. A toggle changes the form; a name no tag has yet is kept by the
/// form (`newNames`, as a new Folder is) and becomes a tag when the form is
/// saved. Cancel leaves the tag list as it was.
export function TagsField({ value, newNames, onChange, onNewNamesChange, onCreate }: {
  value: string[];
  newNames: string[];
  onChange: (tagIds: string[]) => void;
  onNewNamesChange: (names: string[]) => void;
  /** A typed name: the tag of that name, or a new one kept by the form; absent where no tag may be made. */
  onCreate?: (name: string) => void;
}) {
  const t = useT();
  const tags = useTags((s) => s.tags);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  // The new names as the chips they will be: each takes the color a new tag would get.
  const pending = useMemo<Tag[]>(() => {
    const out: Tag[] = [];
    for (const name of newNames) out.push({ id: `${NEW}${name}`, name, color: nextTagColor([...tags, ...out]) });
    return out;
  }, [newNames, tags]);
  const shown = [...tags.filter((tag) => value.includes(tag.id)), ...pending];
  const options = useMemo<ComboboxOption[]>(
    () => [...tags, ...pending].map((tag) => ({ value: tag.id, label: tag.name, content: <TagChip tag={tag} /> })),
    [tags, pending],
  );
  const toggle = (id: string) => {
    if (id.startsWith(NEW)) onNewNamesChange(newNames.filter((n) => `${NEW}${n}` !== id));
    else onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <PropertyRow id="tags" label={t("peek.tags")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} empty={shown.length === 0} wrap expanded={open} onClick={() => setOpen((v) => !v)}>
            {shown.length === 0 ? <span className="truncate">{t("peek.noTags")}</span> : shown.map((tag) => <TagChip key={tag.id} tag={tag} />)}
          </PropertyButton>
          <Popover
            open={open}
            onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}
            anchorRef={anchor}
            align="start"
            aria-label={t("tagPicker.label")}
            className="w-[260px] p-0"
          >
            <Combobox
              multiple
              aria-label={t("tagPicker.find")}
              placeholder={onCreate ? t("tagPicker.find") : t("tagPicker.findOnly")}
              options={options}
              value={[...value, ...pending.map((tag) => tag.id)]}
              query={query}
              // The name a tag would get, cleaned as the store cleans it (PC-085).
              onQueryChange={(q) => setQuery(q.replace(/\s+/g, " ").slice(0, TAG_NAME_MAX))}
              onChange={toggle}
              onCreate={onCreate && ((name) => { onCreate(name); setQuery(""); })}
              createLabel={(name) => t("tagPicker.create", { name })}
              emptyText={tags.length === 0 && pending.length === 0 ? (onCreate ? t("tagPicker.empty") : t("tagPicker.emptyNoCreate")) : undefined}
            />
          </Popover>
        </>
      )}
    </PropertyRow>
  );
}

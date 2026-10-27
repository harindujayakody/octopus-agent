import { useState, type RefObject } from "react";
import { Input } from "@proxyshard/shardx-ui-kit";
import { PropertySheet } from "../../../shared/ui/peek";
import { useT } from "../../../shared/i18n";
import { addTagName, patchDraft, patchForm, problemsOf, useProfileForm, type ProfileFormDraft } from "../model/useProfileForm";
import { CacheRow, ColorRow, CookiesRow, IconRow, NotesRow } from "./fields";
import { FolderField } from "./FolderField";
import { teamRefusal, useInTeam, useRightsChange } from "../../../entities/space";
import { TagsField } from "./TagsField";

/// Basics: the name (required), its Folder, tags, icon, color and notes. The parts
/// the walk through this form points at carry `data-tour`.
export function BasicsTab({ draft, nameRef }: { draft: ProfileFormDraft; nameRef: RefObject<HTMLInputElement | null> }) {
  const t = useT();
  const tried = useProfileForm((s) => s.tried);
  // Said under the field once it was left, or Save was pressed: never while typing the first letter.
  const [blurred, setBlurred] = useState(false);
  const problem = problemsOf(draft).name;
  const f = draft.form;
  // A team's: its profiles take no cookies file yet, and a new tag needs Create in the team.
  const team = useInTeam();
  useRightsChange();
  const keep = useProfileForm((s) => (s.mode === "edit" ? s.saved?.folder : undefined));
  return (
    <div className="flex flex-col gap-4">
      <div data-tour="form-name">
        <Input
          ref={nameRef}
          label={t("profileForm.name")}
          inputSize="xsmall"
          wrapperClassName="gap-[6px]"
          required
          aria-invalid={!!problem || undefined}
          value={f.name}
          error={problem && (blurred || tried) ? problem : undefined}
          onChange={(e) => patchForm({ name: e.target.value })}
          onBlur={() => setBlurred(true)}
        />
      </div>
      <PropertySheet>
        {/* 2 px between 32 px rows, as Peek's sheet. */}
        <div className="flex flex-col gap-[2px]">
          <div data-tour="form-organize" className="flex flex-col gap-[2px]">
            <FolderField value={draft.folder} keep={keep} onChange={(folder) => patchDraft({ folder })} />
            <TagsField
              value={draft.tagIds}
              newNames={draft.newTags}
              onChange={(tagIds) => patchDraft({ tagIds })}
              onNewNamesChange={(newTags) => patchDraft({ newTags })}
              onCreate={teamRefusal("create") ? undefined : addTagName}
            />
          </div>
          <IconRow value={f.icon} onChange={(icon) => patchForm({ icon })} />
          <ColorRow value={f.color} onChange={(color) => patchForm({ color })} />
          <NotesRow value={f.notes} onChange={(notes) => patchForm({ notes })} />
          {!team && <CookiesRow value={draft.cookies} onChange={(cookies) => patchDraft({ cookies })} />}
          {/* An existing profile's cache on this computer: its size, and Clear. */}
          {!team && f.id && <CacheRow id={f.id} name={f.name} />}
        </div>
      </PropertySheet>
    </div>
  );
}

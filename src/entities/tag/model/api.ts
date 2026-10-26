import { invoke } from "../../../shared/api/invoke";
import type { Tag } from "./types";

/** The tags and which profiles carry them, as the backend keeps them (tags.rs). */
export type TagState = { tags: Tag[]; by_profile: Record<string, string[]> };

export const tagList = () => invoke<TagState>("tag_list");
/** Adds the tag or changes the one with its id; a new one goes at `at` when given. */
export const tagSave = (tag: Tag, at?: number) => invoke<Tag>("tag_save", { tag, at: at ?? null });
/** Deletes the tag and takes it off every profile. */
export const tagDelete = (id: string) => invoke<null>("tag_delete", { id });
/** Gives each listed profile exactly these tags; an empty list clears it. */
export const tagAssign = (byProfile: Record<string, string[]>) => invoke<null>("tag_assign", { byProfile });
/** Hands over the copy an older build kept in this window; false when the backend had tags already. */
export const tagImport = (state: TagState) => invoke<boolean>("tag_import", { state });

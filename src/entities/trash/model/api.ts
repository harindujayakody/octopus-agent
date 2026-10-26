import { invoke } from "../../../shared/api/invoke";
import type { ProfileMeta } from "../../profile/model/types";
import type { TrashEntry } from "./types";

export const trashList = () => invoke<TrashEntry[]>("trash_list");
export const trashRestore = (id: string) => invoke<ProfileMeta>("trash_restore", { id });
export const trashPurge = (id: string) => invoke("trash_purge", { id });
export const trashEmpty = () => invoke<number>("trash_empty");

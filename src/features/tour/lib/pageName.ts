import type { ComponentType } from "react";
import { findCommand } from "../../../shared/commands";
import { t } from "../../../shared/i18n";
import type { Section } from "../../../shared/types";

/** A page as the tour names it: the sidebar's label and icon (the "Go to"
 *  command carries both), so a card says what the sidebar says. */
export type TourPage = { name: string; Icon: ComponentType<{ className?: string }> | undefined };

export function pageOf(section: Section): TourPage {
  const go = findCommand(`nav.${section}`);
  return { name: go?.label(1) ?? "", Icon: go?.icon };
}

/** What a card of the walk through the profile form names where a page's name
 *  goes: the form, by its own title ("New profile") and the icon of the
 *  command that opens it. */
export function formPageOf(): TourPage {
  return { name: t("profileForm.newTitle"), Icon: findCommand("profile.new")?.icon };
}

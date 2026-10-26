import type { TourStep } from "../model/types";

/// The walk through the New profile form (owner, 2026-10-08): seven steps on
/// the real form, in the order a first-time user fills it in. The tour
/// switches the form's tabs itself (`formTab`) and each step frames one part
/// of the form (`data-tour`), which the person may use while the walk runs.
/// The steps are in the form, not on a page: `section` is only where the form
/// lives and the engine never changes the page for a run of this kind.
/// `title` and `body` are translation keys, written out in full so that
/// check-i18n sees each one as used.
///
/// Step 7 points at the form's own "Create profile" button (`form-create`,
/// which the kit's dialog footer cannot tag: `findTarget` finds it by what it
/// is). Nothing is created unless the person presses it.
export const profileTour: TourStep[] = [
  { id: "name", section: "profiles", formTab: "basics", target: "form-name", title: "tour.form.name.title", body: "tour.form.name.body" },
  { id: "organize", section: "profiles", formTab: "basics", target: "form-organize", title: "tour.form.organize.title", body: "tour.form.organize.body" },
  { id: "proxy", section: "profiles", formTab: "proxy", target: "form-proxy", title: "tour.form.proxy.title", body: "tour.form.proxy.body" },
  { id: "fingerprint", section: "profiles", formTab: "fingerprint", target: "form-fingerprint", title: "tour.form.fingerprint.title", body: "tour.form.fingerprint.body" },
  { id: "locale", section: "profiles", formTab: "fingerprint", target: "form-locale", title: "tour.form.locale.title", body: "tour.form.locale.body" },
  { id: "extensions", section: "profiles", formTab: "extensions", target: "form-extensions", title: "tour.form.extensions.title", body: "tour.form.extensions.body" },
  { id: "create", section: "profiles", target: "form-create", title: "tour.form.create.title", body: "tour.form.create.body" },
];

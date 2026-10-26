import type { ProfileForm, ProfileMeta } from "../model/types";

/// The last profiles' editor forms, so Peek shows a profile it has seen on
/// the first frame and checks it in the background (PERF-14). Least recently
/// used first; a Map keeps insertion order.
export const FORM_CACHE_SIZE = 50;
const forms = new Map<string, ProfileForm>();

/** The cached form, marked as just used. */
export function cachedForm(id: string): ProfileForm | undefined {
  const form = forms.get(id);
  if (form) { forms.delete(id); forms.set(id, form); }
  return form;
}

/** The cached form, without marking it (safe to call while rendering). */
export function peekForm(id: string): ProfileForm | undefined {
  return forms.get(id);
}

/** Keeps a form, unless the one kept is from a later rev: a read that left
 *  before a save and lands after it never puts the older form back (Pair 18
 *  review, M1). */
export function rememberForm(form: ProfileForm) {
  const kept = forms.get(form.id);
  if (kept && kept.rev > form.rev) return;
  forms.delete(form.id);
  forms.set(form.id, form);
  if (forms.size > FORM_CACHE_SIZE) forms.delete(forms.keys().next().value!);
}

export function forgetForm(id: string) {
  forms.delete(id);
}

/** The fields a row and a form share differ: the form is older than the row. */
const differs = (row: ProfileMeta, form: ProfileForm) =>
  row.name !== form.name || row.notes !== form.notes || row.proxy_id !== form.proxy_id
  || (row.color ?? "") !== form.color || row.extensions.join("\n") !== form.extensions.join("\n");

/** A row that changed (an edit elsewhere, a reload with news) in a field the
 *  form shows has left the form stale; a row gone takes its form with it.
 *  Only those fields count: a start, a stop, a pin or a Folder move leaves
 *  the form as it was, and Peek's own save shows the typed form in the row
 *  (Pair 18 review, M2). */
export function forgetChanged(prev: ProfileMeta[], next: ProfileMeta[]) {
  if (forms.size === 0) return;
  const now = new Map(next.map((p) => [p.id, p]));
  for (const p of prev) {
    const row = now.get(p.id);
    if (row === p) continue;
    const form = forms.get(p.id);
    if (form && (!row || differs(row, form))) forms.delete(p.id);
  }
}

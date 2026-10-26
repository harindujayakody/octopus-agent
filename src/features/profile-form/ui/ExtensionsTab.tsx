import { ExtensionPicker } from "../../manage-profiles";
import { patchForm, type ProfileFormDraft } from "../model/useProfileForm";

/// Extensions: the library's extensions, the ones this profile loads checked.
export function ExtensionsTab({ draft }: { draft: ProfileFormDraft }) {
  return (
    <div data-tour="form-extensions">
      <ExtensionPicker listOnly value={draft.form.extensions} onChange={(extensions) => patchForm({ extensions })} />
    </div>
  );
}

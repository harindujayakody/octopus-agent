import { ExtensionPicker } from "../../manage-profiles";
import { useT } from "../../../shared/i18n";
import { patchForm, type ProfileFormDraft } from "../model/useProfileForm";

/// Extensions: the library's extensions, the ones this profile loads checked.
/// The library holds Chrome extensions: a Firefox profile can't load them, so
/// it says so instead and keeps the add-ons installed inside Firefox.
export function ExtensionsTab({ draft }: { draft: ProfileFormDraft }) {
  const t = useT();
  if (draft.form.engine === "firefox") {
    return (
      <p data-tour="form-extensions" data-extensions-firefox className="m-0 text-secondary text-text-sub-600">
        {t("profileForm.extensionsFirefox")}
      </p>
    );
  }
  return (
    <div data-tour="form-extensions">
      <ExtensionPicker listOnly value={draft.form.extensions} onChange={(extensions) => patchForm({ extensions })} />
    </div>
  );
}

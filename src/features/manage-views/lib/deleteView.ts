import { useProfileUi, useViews } from "../../../entities/profile";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";

/// Deletes a custom View at once, with Undo. The View the list shows is left
/// first, so the list is its own again.
export function deleteView(id: string) {
  const views = useViews.getState().views;
  const index = views.findIndex((v) => v.id === id);
  if (index < 0) return;
  const view = views[index];
  if (useProfileUi.getState().viewId === id) useProfileUi.getState().leaveView();
  useViews.getState().remove(id);
  toast.undo(t("views.deleted", { name: view.name }), () => useViews.getState().restore(view, index));
}

import { automationExport, type Project } from "../../entities/automation";
import { t } from "../../shared/i18n";
import { toast } from "../../shared/model/toast";
import { teamRefusal } from "../../entities/space";

/// Saves a project as a file, and says how many secrets were left blank.
export async function exportProject(project: Project): Promise<void> {
  // A file of a team's project carries it out of the team: Take out.
  const refused = teamRefusal("take_out");
  if (refused) { toast.fail({ title: t("projectEditor.exportFailed", { name: project.name }), detail: refused }); return; }
  try {
    const bundle = await automationExport(project.id);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w.-]+/g, "-")}.shardx-project.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const n = bundle.needs.length;
    toast.ok(
      n === 0
        ? t("projectEditor.exported")
        : n === 1
          ? t("projectEditor.exportedOneSecret")
          : t("projectEditor.exportedSecrets", { n }),
    );
  } catch (e) { toast.fail({ title: t("projectEditor.exportFailed", { name: project.name }), detail: e }); }
}

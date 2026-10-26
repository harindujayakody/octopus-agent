import { IconButton, Input, Switch } from "@proxyshard/shardx-ui-kit";
import { useViews, VIEW_NAME_MAX, type ProfileView } from "../../../entities/profile";
import { deleteView } from "../../../features/manage-views";
import { DeleteIcon } from "../../../shared/icons";
import { focusAfterRowDelete } from "../rowDelete";
import { useT } from "../../../shared/i18n";
import { SettingsGroup } from "../SettingRow";
import { queueViewOp, usePendingView } from "../useSettingsDraft";

/// The Views saved from the Profiles list, to rename, show in the sidebar or
/// delete. A rename or a pin waits for Save with the rest of the page
/// (manual save); a delete runs at once, behind its Undo. Built-ins are not
/// listed: they cannot change.
export function ViewsSection() {
  const t = useT();
  const views = useViews((s) => s.views);
  return (
    // An empty list is one centered line, with no help above it (owner rule).
    <SettingsGroup list help={views.length > 0 ? t("settings.viewsHelp") : undefined}>
      {views.length === 0 ? (
        <p className="m-0 py-6 text-center text-body text-balance text-text-sub-600">{t("settings.viewsEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {views.map((v) => <ViewRow key={v.id} view={v} />)}
        </ul>
      )}
    </SettingsGroup>
  );
}

function ViewRow({ view }: { view: ProfileView }) {
  const t = useT();
  // What the page shows: the waiting rename and pin over the saved ones.
  const { name, pinned, error } = usePendingView(view);
  const rename = (to: string) => queueViewOp({ kind: "rename", id: view.id, name: to });

  return (
    <li data-view-row={view.id} className="row-line relative flex items-center gap-4 px-cell py-3">
      <div className="w-[240px] shrink-0">
        <Input
          aria-label={t("settings.viewNameFor", { name: view.name })}
          inputSize="xsmall"
          value={name}
          maxLength={VIEW_NAME_MAX}
          error={error}
          onChange={(e) => rename(e.target.value)}
          // An empty name is no name: leaving the field keeps the one it had.
          onBlur={() => { if (!name.trim()) rename(view.name); }}
          onKeyDown={(e) => {
            // An Esc that cancels an input method's text is its own.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") rename(view.name);
          }}
        />
      </div>
      <Switch
        role="switch"
        aria-label={t("settings.viewPinned", { name: view.name })}
        label={t("settings.viewPinnedShort")}
        checked={pinned}
        onChange={(on) => queueViewOp({ kind: "pin", id: view.id, pinned: on })}
      />
      <IconButton
        data-row-delete
        className="ml-auto"
        size="2xsmall"
        icon={<DeleteIcon className="size-3.5" />}
        label={t("settings.viewDelete", { name: view.name })}
        onClick={(e) => {
          const next = focusAfterRowDelete(e.currentTarget);
          deleteView(view.id);
          next();
        }}
      />
    </li>
  );
}

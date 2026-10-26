import {
  ProfilesMoreMenu,
  NewProfileButton,
  ProfileFilterBar,
  ProfileDisplayMenu,
  SaveAsViewButton,
} from "../../features/manage-profiles";

/// Filters and Display act on rows; with none they are noise (LAYOUT-20).
export function ProfileToolbar({ empty = false }: { empty?: boolean }) {
  return (
    <div className="flex items-center flex-none gap-2">
      {!empty && <SaveAsViewButton />}
      {/* One box for the tour to point at: Filters and Display. */}
      {!empty && (
        <div data-tour="list-tools" className="flex items-center gap-2">
          <ProfileFilterBar />
          <ProfileDisplayMenu />
        </div>
      )}
      <ProfilesMoreMenu />
      <NewProfileButton />
    </div>
  );
}

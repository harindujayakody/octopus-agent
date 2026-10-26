import { HeaderMenu } from "../../../widgets/PageHeader/HeaderMenu";
import { menuItemsFor } from "../../commands";

/// The Profiles header's `…` menu: the page's secondary actions (EMIL-20: at
/// least two, or it would be a button with an extra step). The page's
/// commands come from the registry, in the words Cmd+K uses (E4), and so
/// does New folder…, with its one glyph (owner 5r) and its one name (mp4
/// review M3: it opens a dialog, so it ends in "…" everywhere).
export function ProfilesMoreMenu() {
  return (
    <HeaderMenu
      items={[
        ...menuItemsFor("pageMenu", "profiles", { ids: [] }),
        ...menuItemsFor("pageMenu", "app", { ids: [] }),
      ]}
    />
  );
}

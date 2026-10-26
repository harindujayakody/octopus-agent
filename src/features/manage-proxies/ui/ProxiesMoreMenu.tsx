import { HeaderMenu } from "../../../widgets/PageHeader/HeaderMenu";
import { menuItemsFor } from "../../commands";

/// The Proxies header's `…` menu: the page's commands from the registry (E4).
export function ProxiesMoreMenu() {
  return <HeaderMenu items={menuItemsFor("pageMenu", "proxies", { ids: [] })} />;
}

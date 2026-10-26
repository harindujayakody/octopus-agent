import { confirmLeave } from "../../../shared/model/unsaved";
import { useAutomation } from "./useAutomation";

/// The way back from the project editor to the projects list: Back, Esc, and
/// the sidebar's Automation item (clicked on its own page) all end here. With
/// changes not yet saved it asks first (Save, Don't save, Cancel); resolves
/// false when the person stayed. With no project open it does nothing and
/// resolves true.
export async function leaveEditor(): Promise<boolean> {
  if (useAutomation.getState().openId === null) return true;
  if (!(await confirmLeave())) return false;
  useAutomation.getState().open(null);
  return true;
}

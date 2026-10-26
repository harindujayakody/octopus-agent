import { Portal } from "@proxyshard/shardx-ui-kit";
import { useAnnouncer } from "../../shared/model/announce";

/// The app's two live regions, present from the first frame (a region added
/// together with its text is often not read) and outside #root, so a dialog
/// that makes the page inert does not silence them. `announce()` fills them:
/// successes politely, errors assertively (A11Y-05).
export function LiveAnnouncer() {
  const polite = useAnnouncer((s) => s.polite);
  const assertive = useAnnouncer((s) => s.assertive);
  return (
    <Portal>
      <div data-live="polite" role="status" aria-live="polite" aria-atomic="true" className="sr-only">{polite}</div>
      <div data-live="assertive" role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">{assertive}</div>
    </Portal>
  );
}

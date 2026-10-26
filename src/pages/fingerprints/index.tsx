import { useEffect } from "react";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { useFingerprint, useVisibleFingerprints } from "../../entities/fingerprint";
import { FingerprintImporter } from "../../features/manage-fingerprints";
import { FingerprintLibrary } from "../../widgets/FingerprintLibrary/FingerprintLibrary";
import { FingerprintToolbar } from "../../widgets/FingerprintLibrary/FingerprintToolbar";
import { FingerprintFilterBar } from "../../widgets/FingerprintLibrary/FingerprintFilterBar";
import { FingerprintPeek, focusFingerprintCard } from "../../widgets/FingerprintPeek";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { keyboardIsTaken, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { useT } from "../../shared/i18n";
import { showMeAround } from "../../features/tour";

export function FingerprintsPage() {
  const t = useT();
  const init = useFingerprint((s) => s.init);
  const reload = useFingerprint((s) => s.reload);
  const importerOpen = useFingerprint((s) => s.importerOpen);
  const setImporterOpen = useFingerprint((s) => s.setImporterOpen);
  // Stays mounted through its exit (FEEL-01).
  const importerLife = useDialogLife(importerOpen);
  const count = useVisibleFingerprints().length;
  const status = useFingerprint((s) => s.status);
  const ready = status === "ready";
  // The library's placeholder cards wait 150 ms and stay 400 ms (WIG-12);
  // the count waits for them (held here, and passed to the library).
  const loading = useHeldLoading(status === "idle" || status === "loading");
  const search = useFingerprint((s) => s.search);
  const setSearch = useFingerprint((s) => s.setSearch);
  // An empty library has nothing to count or filter (LAYOUT-20); while it
  // loads, the filters stay where the cards will be.
  const showControls = useFingerprint((s) => s.status !== "ready" || s.items.length > 0);

  useEffect(() => { init(); }, [init]);

  // Esc closes Peek, from the grid or from inside it; a dialog, menu or
  // another field keeps its own Esc.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || overlayHasKeyboard()) return;
      const { peekId, closePeek } = useFingerprint.getState();
      if (!peekId) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (keyboardIsTaken(target) && !target?.closest("[data-peek]")) return;
      e.preventDefault();
      closePeek();
      focusFingerprintCard(peekId);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <PageHeader
        title={t("fingerprints.title")}
        count={!loading && ready && showControls ? count : undefined}
        help={{ title: t("pageHelp.fingerprints.title"), body: t("pageHelp.fingerprints.body"), onTour: () => showMeAround("fingerprints") }}
        filter={showControls ? { value: search, onChange: setSearch } : undefined}
        actions={<FingerprintToolbar />}
      />
      <PageBody scroll={false} className="relative">
        {/* Peek always pushes the grid: it never lies over it.
            It starts at the top of the page body, as the other Peeks do; the
            filters belong to the grid's column (LAYOUT-12). */}
        <div className="relative flex min-h-0 flex-1 gap-panel">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {showControls && <FingerprintFilterBar />}
            {/* p-1.5 with -m-1.5: room for the grid's own scroll box, which
                reaches past its cards by a ring and a lift (the kit DataList)
                so a card's ring is never cut off; the cards stay where they
                were. The grid scrolls itself. */}
            <div data-tour="fingerprints" className="-m-1.5 flex min-h-0 flex-1 flex-col p-1.5">
              <FingerprintLibrary loading={loading} />
            </div>
          </div>
          <FingerprintPeek />
        </div>
      </PageBody>
      {importerLife.mounted && (
        <FingerprintImporter key={importerLife.session} open={importerOpen} onClose={() => { setImporterOpen(false); reload(); }} />
      )}
    </>
  );
}

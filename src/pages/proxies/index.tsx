import { useEffect } from "react";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { countActiveProxyFilters, useFilteredProxies, useProxy } from "../../entities/proxy";
import { storeBus } from "../../shared/lib/storeBus";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { ProxyBulkImporter, ProxyFilterChips } from "../../features/manage-proxies";
import { ProxyList } from "../../widgets/ProxyList";
import { ProxyToolbar } from "../../widgets/ProxyList/ProxyToolbar";
import { ProxyPeek } from "../../widgets/ProxyPeek";
import { ProxyBulkBar } from "../../widgets/ProxyBulkBar";
import { useT } from "../../shared/i18n";
import { ListColumn } from "../../shared/ui/ListColumn";
import { showMeAround } from "../../features/tour";

export function ProxiesPage() {
  const t = useT();
  const init = useProxy((s) => s.init);
  const reload = useProxy((s) => s.reload);
  const search = useProxy((s) => s.search);
  const setSearch = useProxy((s) => s.setSearch);
  const filterCount = useProxy((s) => countActiveProxyFilters(s.filters));
  const count = useFilteredProxies().length;
  const total = useProxy((s) => s.proxies.length);
  const status = useProxy((s) => s.status);
  const ready = status === "ready";
  const bulkOpen = useProxy((s) => s.bulkOpen);
  const setBulkOpen = useProxy((s) => s.setBulkOpen);
  // It stays mounted through its exit (FEEL-01).
  const bulkLife = useDialogLife(bulkOpen);
  // No proxies at all: nothing to filter or count (LAYOUT-20).
  const empty = ready && total === 0 && !search.trim() && filterCount === 0;
  // The list's placeholder rows wait 150 ms and stay 400 ms (WIG-12); the
  // count waits for them (held here, and passed to the list: one value).
  const loading = useHeldLoading(status === "idle" || status === "loading");

  useEffect(() => { init(); }, [init]);
  // Pick up proxies/profiles added via the automation API or MCP live.
  useStoreChanged(reload);

  return (
    <>
      <PageHeader
        title={t("proxies.title")}
        count={!loading && ready && !empty ? (search.trim() || filterCount > 0 ? { shown: count, total } : count) : undefined}
        help={{ title: t("pageHelp.proxies.title"), body: t("pageHelp.proxies.body"), onTour: () => showMeAround("proxies") }}
        filter={empty ? undefined : { value: search, onChange: setSearch }}
        actions={<ProxyToolbar empty={empty} />}
      />
      <PageBody scroll={false} className="relative">
        <ProxyFilterChips />
        {/* Peek always pushes the list: it never lies over it. */}
        <div className="relative flex min-h-0 flex-1 gap-panel">
          {/* The list's own column: its bar and the toasts stay off Peek (F2). */}
          <ListColumn>
            {/* Before the list in Tab order; it floats over the list's bottom edge. */}
            <ProxyBulkBar />
            <ProxyList loading={loading} />
          </ListColumn>
          <ProxyPeek />
        </div>
      </PageBody>
      {bulkLife.mounted && (
        <ProxyBulkImporter
          key={bulkLife.session}
          open={bulkOpen}
          onClose={(added) => {
            setBulkOpen(false);
            reload();
            // This store has just reloaded: only the Profiles side reads them again.
            storeBus.emit("proxies", "proxies");
            // One proxy added from the preview opens in Peek, as New profile does (CRAFT-26).
            if (added) useProxy.getState().openPeek(added);
          }}
        />
      )}
    </>
  );
}

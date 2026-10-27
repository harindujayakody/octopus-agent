import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataList, DialogModal, EmptyState, Input, SegmentControl, Tooltip, useLatched, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { AddExtensionMenu, LinkStoreDialog, UpdateConfirmDialog, UpdateStatus, stopAndUpdate } from "../../features/manage-extensions";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { useArrivedIds } from "../../shared/hooks/useArrivedIds";
import { AddIcon, CloseIcon, DownloadIcon, ExternalLinkIcon, GlobeIcon, NavExtensionsIcon, RefreshIcon, SearchIcon, StopIcon, UndoIcon } from "../../shared/icons";
import { LoadError, LoadingCards } from "../../shared/ui/ListStates";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import {
  canUpdate, extensionKey, extensionLinkAllowed, extensionName, goneFromStore, iconSrc, installCounts, isStoreLink, normalizeExtensionLink, storeIdOf,
  useExtensionUpdates, useExtensions, versionAtLeast, type ExtensionEntry, type ExtensionFamily, type ExtensionUpdate,
} from "../../entities/extension";
import { useGpuCompat } from "../../shared/model/gpuCompat";
import { teamRefusal, useRightsChange } from "../../entities/space";
import { fmtBytes } from "../../shared/lib/format";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { useT } from "../../shared/i18n";
import { useScrollMemory } from "../../shared/model/scrollMemory";
import { refocusPageFilter } from "../../shared/lib/focus";
import { showMeAround } from "../../features/tour";
import { ProfileExtensions } from "./ProfileExtensions";

/** `copies`: how many times it is installed, by Web Store item or else name and version (1 when once).
 *  `update`: where its Web Store update stands, when it has a record. */
function ExtensionCard({ e, copies, update, linking }: { e: ExtensionEntry; copies: number; update?: ExtensionUpdate; linking: boolean }) {
  const t = useT();
  const src = iconSrc(e.icon);
  const name = extensionName(e);
  return (
    // Content on its own element: an article. The grid item around it is the
    // tile (the kit DataList's) and what takes focus; Remove is in its menu (CRAFT-03).
    // It fills its grid cell, so every card in a row is as tall and their
    // bottoms line up (UI-39).
    // min-w-0: the card is never wider than its cell, whatever its text; the
    // name is cut and the description wraps inside it.
    <article className="flex h-full w-full min-w-0 flex-col gap-2.5 rounded-tile px-cell py-[10px]">
      <div className="flex min-w-0 items-start gap-2.5">
        {src ? (
          <img src={src} alt="" className="size-[35px] shrink-0 rounded-control object-contain outline outline-1 -outline-offset-1 outline-stroke-image" />
        ) : (
          <div className="grid size-[35px] shrink-0 place-items-center rounded-control bg-bg-on-tile text-icon-sub-600">
            <NavExtensionsIcon className="size-3.5" />
          </div>
        )}
        {/* pe-5: room for the card's More button (top right, on hover), so it never sits on the name. */}
        <div className="min-w-0 flex-1 pe-5">
          {/* The whole name on hover, only when it is cut. */}
          <Tooltip content={name} whenTruncated><h2 className="m-0 truncate text-secondary font-medium text-text-strong-950">{name}</h2></Tooltip>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary text-text-soft-400">
            <span className="truncate">{e.version ? `v${e.version}, ${fmtBytes(e.size_bytes)}` : fmtBytes(e.size_bytes)}</span>
            {/* The same extension twice: each card says so and keeps its own Remove. */}
            {copies > 1 && (
              <Badge size="small" color="warning" className="shrink-0">
                {copies === 2 ? t("extensions.installedTwice") : t("extensions.installedTimes", { n: copies })}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <UpdateStatus update={update} linking={linking} />
      {/* Not stretched to the card's height: a third line would show under the clamp
          when a card beside it is taller (an update's status). */}
      <p className="m-0 line-clamp-2 min-h-[2.4em] break-words text-secondary text-text-sub-600">
        {e.description || <span className="text-text-soft-400">{t("extensions.noDescription")}</span>}
      </p>
    </article>
  );
}

/** Add by address: a Web Store page, a bare id, or a .crx / .zip link. */
function LinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const busy = useExtensions((s) => s.busy);
  const importUrl = useExtensions((s) => s.importUrl);
  // Trimmed of every Unicode whitespace character, not just what JS's own
  // `trim()` removes: the backend's Rust `trim()` strips more (e.g. U+0085
  // NEL), so a link that hides its real scheme behind it must be judged the
  // way the backend will actually see it, not the way JS shows it (SEC-08).
  const link = normalizeExtensionLink(url);
  // A parsed https URL or a bare id only; a plain-http file can be swapped on
  // the way, and anything else is not a scheme this app downloads through.
  const allowed = link !== "" && extensionLinkAllowed(link);
  const disallowed = link !== "" && !allowed;
  // Allowed, but not a known Web Store address: unknown author, and it can
  // read every page of the profiles it goes into (SEC-08).
  const offStore = allowed && !isStoreLink(link);
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      // The link typed in: Esc, the close button and Cancel ask before dropping it.
      dirty={url !== ""}
      title={t("extensions.linkTitle")}
      confirmLabel={busy ? t("extensions.downloading") : t("extensions.download")}
      onConfirm={() => importUrl(link)}
      isLoading={busy}
      isDisabled={busy || !link || !allowed}
      cancelLabel={t("extensions.cancel")}
      onCancel={onClose}
    >
      <div className="flex w-full flex-col gap-3 py-4">
        <Input
          label={t("extensions.linkFieldLabel")}
          inputSize="xsmall"
          className="mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://chromewebstore.google.com/detail/…"
          error={disallowed ? t("extensions.linkHttp") : undefined}
          hint={offStore ? t("extensions.linkOffStore") : undefined}
        />
        <p className="m-0 text-secondary text-text-soft-400">{t("extensions.linkHelp")}</p>
      </div>
    </DialogModal>
  );
}

/// A card's update actions by where its update stands (the contract's table):
/// Update, Stop N profiles and update, Cancel, Skip, Link, Open in Web Store.
/// A Web Store flag closes Update and says why.
function useUpdateMenu() {
  const t = useT();
  return (e: ExtensionEntry, u: ExtensionUpdate | undefined, busy: boolean): MenuItem[] => {
    const store = useExtensionUpdates.getState();
    const icon = (I: typeof DownloadIcon) => <I className="size-3.5" />;
    const flagged = !!u?.flags.length;
    const update = (label: string, run: () => void): MenuItem => ({
      label, icon: icon(DownloadIcon), disabled: busy || flagged, hint: flagged ? t("extensions.flagged") : undefined, onSelect: run,
    });
    const cancel: MenuItem = { label: t("extensions.cancelUpdate"), icon: icon(CloseIcon), onSelect: () => void store.cancel(e) };
    const skip: MenuItem = { label: t("extensions.skipVersion"), icon: icon(UndoIcon), disabled: busy, onSelect: () => void store.skip(e) };
    const out: MenuItem[] = [];
    // A link under way downloads to compare files: nothing to cancel or update yet.
    if (store.linking[e.id]) return out;
    switch (u?.state) {
      case "unlinked":
        out.push({ label: t("extensions.linkStore"), icon: icon(GlobeIcon), onSelect: () => store.setLinkFor(e) });
        break;
      case "available":
        out.push(update(t("extensions.updateItem"), () => void store.update(e)), skip);
        break;
      case "ready":
        out.push(update(t("extensions.updateItem"), () => void store.update(e)), cancel, skip);
        break;
      // The question is in the record already: the dialog opens at once.
      case "confirm":
        out.push(update(t("extensions.updateConfirmItem"), () => store.setAsk({ entry: e, update: u })), cancel, skip);
        break;
      case "downloading":
        out.push(cancel);
        break;
      // Cancel would only offer it again, to be downloaded and refused again:
      // Update once the engine here is new enough, else Skip.
      case "needs_engine": {
        const engine = useGpuCompat.getState().caps?.engine_version;
        if (engine && u.needs_engine && versionAtLeast(engine, u.needs_engine)) out.push(update(t("extensions.updateItem"), () => void store.update(e)));
        if (u.latest) out.push(skip);
        break;
      }
      case "waiting": {
        const n = u.waiting_on.length;
        if (n > 0) {
          out.push({
            label: n === 1 ? t("extensions.stopAndUpdateOne", { n }) : t("extensions.stopAndUpdateMany", { n }),
            icon: icon(StopIcon), onSelect: () => void stopAndUpdate(e, u),
          });
        }
        out.push(cancel);
        break;
      }
      // Taken down from the Web Store: Update would only be refused again. Skip hides the failed version.
      case "failed":
        if (!goneFromStore(u)) out.push(update(t("extensions.updateItem"), () => void store.update(e)));
        if (u.latest) out.push(skip);
        break;
    }
    if (storeIdOf(e)) out.push({ label: t("extensions.openInStore"), icon: icon(ExternalLinkIcon), onSelect: () => store.openInStore(e) });
    return out;
  };
}

export function ExtensionsPage() {
  const t = useT();
  // The library, or the extensions profiles installed by themselves (with a Chromium / Firefox filter).
  const [view, setView] = useState<"library" | "profiles">("library");
  const [family, setFamily] = useState<"all" | ExtensionFamily>("all");
  // The grid scrolls itself; it keeps its place across page switches (WIG-06).
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory(scrollRef, "extensions");
  const init = useExtensions((s) => s.init);
  const items = useExtensions((s) => s.items);
  const status = useExtensions((s) => s.status);
  const loadError = useExtensions((s) => s.error);
  const search = useExtensions((s) => s.search);
  const setSearch = useExtensions((s) => s.setSearch);
  const linkOpen = useExtensions((s) => s.linkOpen);
  const setLinkOpen = useExtensions((s) => s.setLinkOpen);
  // Stays mounted through its exit (FEEL-01).
  const linkLife = useDialogLife(linkOpen);

  const reload = useExtensions((s) => s.reload);
  useEffect(() => { init(); }, [init]);
  // Pick up extensions added through the automation API (an update's own changes are read by the Shell).
  useStoreChanged(reload, ["extensions"]);

  // Web Store updates: read on every page (App.tsx), shown and acted on here.
  const updates = useExtensionUpdates((s) => s.byId);
  const working = useExtensionUpdates((s) => s.working);
  const linking = useExtensionUpdates((s) => s.linking);
  const checking = useExtensionUpdates((s) => s.checking);
  const updatingAll = useExtensionUpdates((s) => s.updatingAll);
  const linkFor = useExtensionUpdates((s) => s.linkFor);
  const linkStoreFor = useLatched(linkFor);
  const linkStoreLife = useDialogLife(linkFor !== null);
  const updateMenu = useUpdateMenu();
  // Linked ones only: a check of none asks nothing (§3.2.1).
  const anyLinked = Object.values(updates).some((u) => u.state !== "unlinked");
  const updatable = items.filter((e) => canUpdate(updates[e.id])).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) => extensionName(e).toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [items, search]);
  // Counted over every extension, not the search: two copies stay two while one is filtered out.
  const counts = useMemo(() => installCounts(items), [items]);

  const remove = useExtensions((s) => s.remove);
  // A team's rules: adding and removing each need their right in the team.
  useRightsChange();
  const noCreate = teamRefusal("create");
  const noDelete = teamRefusal("delete");
  const loading = useHeldLoading(status === "idle" || status === "loading");
  // Nothing to count or filter yet (LAYOUT-20).
  const empty = status === "ready" && items.length === 0;
  // A query hidden with the field would come back with the first extension.
  useEffect(() => { if (empty) setSearch(""); }, [empty, setSearch]);
  // An added extension (a link, a file, a folder, the API) slides in once.
  const arrived = useArrivedIds(items.map((e) => e.id), status === "ready");

  const emptyState = items.length > 0 && search.trim() ? (
    <EmptyState
      icon={<SearchIcon />}
      title={t("extensions.noMatchTitle", { q: search.trim() })}
      actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
    />
  ) : (
    <EmptyState icon={<NavExtensionsIcon />} title={t("extensions.emptyTitle")} hint={t("extensions.emptyHelp")} action={noCreate ? undefined : { label: t("extensions.emptyAction"), icon: <AddIcon />, onClick: () => setLinkOpen(true) }} />
  );

  return (
    <>
      <PageHeader
        title={t("extensions.title")}
        count={!loading && status === "ready" && !empty ? shown.length : undefined}
        help={{ title: t("pageHelp.extensions.title"), body: t("pageHelp.extensions.body"), onTour: () => showMeAround("extensions") }}
        filter={empty && view === "library" ? undefined : { value: search, onChange: setSearch }}
        after={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentControl
              size="xsmall"
              aria-label={t("extensions.viewLabel")}
              value={view}
              items={[
                { value: "library", label: t("extensions.viewLibrary") },
                { value: "profiles", label: t("extensions.inProfiles") },
              ]}
              onChange={(v) => setView(v as "library" | "profiles")}
            />
            {view === "profiles" && (
              <SegmentControl
                size="xsmall"
                aria-label={t("extensions.familyLabel")}
                value={family}
                items={[
                  { value: "all", label: t("extensions.familyAll") },
                  { value: "chromium", label: t("extensions.familyChromium") },
                  { value: "firefox", label: t("extensions.familyFirefox") },
                ]}
                onChange={(v) => setFamily(v as "all" | ExtensionFamily)}
              />
            )}
          </div>
        }
        actions={
          <>
            {/* Its words in a tooltip only while a narrow header shows its icon alone. */}
            {anyLinked && !empty && (
              <Tooltip content={t("extensions.checkUpdates")} whenTruncated>
                <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<RefreshIcon className="size-3.5" />} isLoading={checking} onClick={() => void useExtensionUpdates.getState().check()}>
                  {checking ? t("extensions.checking") : t("extensions.checkUpdates")}
                </Button>
              </Tooltip>
            )}
            {/* Stays while it runs: the first one going in drops the count. */}
            {(updatable >= 2 || updatingAll) && (
              <Tooltip content={t("extensions.updateAll")} whenTruncated>
                <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<DownloadIcon className="size-3.5" />} isLoading={updatingAll} onClick={() => void useExtensionUpdates.getState().updateAll()}>
                  {t("extensions.updateAll")}
                </Button>
              </Tooltip>
            )}
            <AddExtensionMenu />
          </>
        }
      />
      {/* The grid scrolls itself; the page does not. The list recipe's card
          grid (F5, IFACE-11): one Tab stop, arrows move by what is beside,
          above and below, Remove in a card's menu and on the Delete key (it
          asks first). The states center in the same tile a table sits on. */}
      <PageBody scroll={false}>
        {view === "profiles" ? <ProfileExtensions family={family} search={search} /> : (
        <DataList<ExtensionEntry>
          variant="grid"
          // Wide enough for a name and its version on a line (a narrower card cuts both).
          minCardWidth={280}
          scrollRef={scrollRef}
          aria-label={t("extensions.title")}
          items={shown}
          getId={(e) => e.id}
          getName={extensionName}
          labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
          status={loading ? "loading" : status === "error" ? "error" : "ready"}
          loading={<LoadingCards />}
          error={<LoadError what={t("listStates.extensions")} error={loadError} onRetry={() => void init()} />}
          empty={emptyState}
          arrived={arrived}
          renderCard={(e) => <ExtensionCard e={e} copies={counts.get(extensionKey(e)) ?? 1} update={updates[e.id]} linking={!!linking[e.id]} />}
          onDelete={(ids) => {
            for (const id of ids) {
              const e = items.find((x) => x.id === id);
              if (e) void remove(e);
            }
          }}
          menuItems={(e) => {
            const first = updateMenu(e, updates[e.id], !!working[e.id]);
            // The backend refuses it while the new version goes in.
            const swapping = updates[e.id]?.state === "downloading" || updates[e.id]?.state === "applying";
            const noRemove = noDelete ?? (swapping ? t("extensions.removeWhileUpdating") : null);
            return [
              ...first,
              ...(first.length > 0 ? [{ type: "separator" as const }] : []),
              { label: t("extensions.removeItem"), icon: rowActionIcons.trash({ className: "size-3.5" }), danger: true, disabled: !!noRemove, hint: noRemove ?? undefined, onSelect: () => void remove(e) },
            ];
          }}
        />
        )}
      </PageBody>

      {linkLife.mounted && <LinkDialog key={linkLife.session} open={linkOpen} onClose={() => setLinkOpen(false)} />}
      {linkStoreLife.mounted && linkStoreFor && (
        <LinkStoreDialog key={linkStoreLife.session} entry={linkStoreFor} open={linkFor !== null} onClose={() => useExtensionUpdates.getState().setLinkFor(null)} />
      )}
      <UpdateConfirmDialog />
    </>
  );
}

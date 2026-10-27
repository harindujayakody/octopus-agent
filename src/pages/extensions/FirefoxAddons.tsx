import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, DataList, EmptyState, Input, Tooltip } from "@proxyshard/shardx-ui-kit";
import { AdBlockIcon, AddIcon, DownloadIcon, NavExtensionsIcon, SearchIcon } from "../../shared/icons";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import { LoadError, LoadingCards } from "../../shared/ui/ListStates";
import { toast } from "../../shared/model/toast";
import { confirmModal } from "../../shared/model/confirm";
import { useT } from "../../shared/i18n";
import {
  firefoxAddonDelete, firefoxAddonImportFile, firefoxAddonImportUrl, firefoxAddonList, type FirefoxAddon,
} from "../../features/firefox-addons/api";

const UBLOCK_ORIGIN = "uBlock0@raymondhill.net";

/// The Firefox add-ons library: every Firefox profile starts with all of them,
/// pinned on its toolbar. Added from an addons.mozilla.org link or a signed .xpi.
export function FirefoxAddons({ search }: { search: string }) {
  const t = useT();
  const [items, setItems] = useState<FirefoxAddon[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setItems(await firefoxAddonList());
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };
  useEffect(() => { void load(); }, []);

  const add = async (how: () => Promise<FirefoxAddon>, what: string) => {
    setBusy(true);
    try {
      const a = await how();
      setItems((xs) => [...xs.filter((x) => x.id !== a.id), a].sort((x, y) => x.name.localeCompare(y.name)));
      setLink("");
      toast.ok(t("extensions.addonAdded", { name: a.name || a.id }));
    } catch (e) {
      toast.fail({ title: t("extensions.addonAddFailed", { name: what }), detail: e, subject: what });
    } finally {
      setBusy(false);
    }
  };
  const fromFile = async () => {
    const path = await open({ title: t("extensions.addonPickTitle"), filters: [{ name: t("extensions.addonPickFilter"), extensions: ["xpi"] }] });
    if (typeof path === "string") await add(() => firefoxAddonImportFile(path), path.split(/[\\/]/).pop() ?? path);
  };
  const remove = async (a: FirefoxAddon) => {
    const name = a.name || a.id;
    const ok = await confirmModal({
      title: t("extensions.addonRemoveTitle", { name }),
      message: t("extensions.addonRemoveMessage"),
      confirmLabel: t("extensions.removeItem"),
      danger: true,
    });
    if (!ok) return;
    try {
      await firefoxAddonDelete(a.id);
      setItems((xs) => xs.filter((x) => x.id !== a.id));
    } catch (e) {
      toast.fail({ title: t("extensions.addonRemoveFailed", { name }), detail: e, subject: name });
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) : items;
  }, [items, search]);
  const haveUblock = items.some((a) => a.id === UBLOCK_ORIGIN);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form
        data-addon-add
        className="flex flex-wrap items-center gap-2 [&_button]:whitespace-nowrap"
        onSubmit={(e) => {
          e.preventDefault();
          const v = link.trim();
          if (v) void add(() => firefoxAddonImportUrl(v), v);
        }}
      >
        <div className="min-w-[220px] flex-1">
          <Input
            aria-label={t("extensions.addonLinkLabel")}
            placeholder={t("extensions.addonLinkPlaceholder")}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            spellCheck={false}
          />
        </div>
        <Button type="submit" variant="primary" mode="filled" size="xsmall" leftIcon={<AddIcon className="size-3.5" />} isLoading={busy} disabled={!link.trim()}>
          {t("extensions.addonAdd")}
        </Button>
        <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<DownloadIcon className="size-3.5" />} disabled={busy} onClick={() => void fromFile()}>
          {t("extensions.addonFromFile")}
        </Button>
        {!haveUblock && status === "ready" && (
          <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<AdBlockIcon className="size-3.5" />} disabled={busy} onClick={() => void add(() => firefoxAddonImportUrl("ublock-origin"), "uBlock Origin")}>
            {t("extensions.addonUblock")}
          </Button>
        )}
      </form>
      <DataList<FirefoxAddon>
        variant="grid"
        minCardWidth={280}
        aria-label={t("extensions.viewFirefox")}
        items={shown}
        getId={(a) => a.id}
        getName={(a) => a.name || a.id}
        labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
        status={status}
        loading={<LoadingCards />}
        error={<LoadError what={t("extensions.viewFirefox")} error={error} onRetry={() => void load()} />}
        empty={
          items.length > 0
            ? <EmptyState icon={<SearchIcon />} title={t("extensions.noMatchTitle", { q: search.trim() })} />
            : <EmptyState icon={<NavExtensionsIcon />} title={t("extensions.addonEmptyTitle")} hint={t("extensions.addonEmptyHelp")} />
        }
        renderCard={(a) => (
          <article data-addon={a.id} className="flex h-full w-full min-w-0 flex-col gap-1.5 rounded-tile px-cell py-[10px]">
            <Tooltip content={a.name || a.id} whenTruncated>
              <h2 className="m-0 truncate text-secondary font-medium text-text-strong-950">{a.name || a.id}</h2>
            </Tooltip>
            <div className="flex min-w-0 items-center gap-1.5 text-secondary text-text-soft-400">
              {a.version && <span className="truncate">v{a.version}</span>}
              <Badge size="small" color="warning" className="shrink-0">{t("extensions.familyFirefox")}</Badge>
            </div>
            <p className="mono m-0 truncate text-secondary text-text-sub-600">{a.id}</p>
          </article>
        )}
        onDelete={(ids) => {
          for (const id of ids) {
            const a = items.find((x) => x.id === id);
            if (a) void remove(a);
          }
        }}
        menuItems={(a) => [
          { label: t("extensions.removeItem"), icon: rowActionIcons.trash({ className: "size-3.5" }), danger: true, onSelect: () => void remove(a) },
        ]}
      />
    </div>
  );
}

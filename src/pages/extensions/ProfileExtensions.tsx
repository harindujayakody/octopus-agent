import { useEffect, useMemo } from "react";
import { Badge, Button, DataList, EmptyState, Tooltip } from "@proxyshard/shardx-ui-kit";
import {
  addProfileExtensionToLibrary, iconSrc, loadProfileExtensions, useExtensions, useProfileExtensions,
  type ExtensionFamily, type InProfileExtension,
} from "../../entities/extension";
import { useProfile } from "../../entities/profile";
import { NavExtensionsIcon, SearchIcon } from "../../shared/icons";
import { LoadError, LoadingCards } from "../../shared/ui/ListStates";
import { toast } from "../../shared/model/toast";
import { firefoxAddonImportUrl } from "../../features/firefox-addons/api";
import { useT } from "../../shared/i18n";

/// The extensions profiles installed by themselves, inside their browsers,
/// beside the library. A Chrome extension can be added to the library (and
/// from there to other profiles); a Firefox add-on stays with its Firefox
/// profiles, since Chromium browsers can't load it. `family` narrows the
/// list to one kind; `search` to a name.
export function ProfileExtensions({ family, search }: { family: "all" | ExtensionFamily; search: string }) {
  const t = useT();
  const status = useProfileExtensions((s) => s.status);
  const items = useProfileExtensions((s) => s.items);
  const error = useProfileExtensions((s) => s.error);
  const library = useExtensions((s) => s.items);
  // Read again each time this view opens: a profile may have added one since.
  useEffect(() => { void loadProfileExtensions(); }, []);

  const inLibrary = useMemo(
    () => new Set(library.flatMap((e) => (e.source?.kind === "webstore" ? [e.source.id] : []))),
    [library],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((x) => (family === "all" || x.family === family) && (!q || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q)));
  }, [items, family, search]);

  return (
    <DataList<InProfileExtension>
      variant="grid"
      minCardWidth={280}
      aria-label={t("extensions.inProfiles")}
      items={shown}
      getId={(x) => `${x.family}:${x.ext_id}`}
      getName={(x) => x.name || x.ext_id}
      labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
      status={status === "idle" || status === "loading" ? "loading" : status === "error" ? "error" : "ready"}
      loading={<LoadingCards />}
      error={<LoadError what={t("extensions.inProfiles")} error={error} onRetry={() => void loadProfileExtensions()} />}
      empty={
        items.length > 0
          ? <EmptyState icon={<SearchIcon />} title={t("extensions.inProfilesNoMatch")} />
          : <EmptyState icon={<NavExtensionsIcon />} title={t("extensions.inProfilesEmpty")} hint={t("extensions.inProfilesEmptyHelp")} />
      }
      renderCard={(x) => <InProfileCard x={x} inLibrary={x.family === "chromium" && inLibrary.has(x.ext_id)} />}
    />
  );
}

function InProfileCard({ x, inLibrary }: { x: InProfileExtension; inLibrary: boolean }) {
  const t = useT();
  const profiles = useProfile((s) => s.profiles);
  const adding = useProfileExtensions((s) => !!s.adding[x.ext_id]);
  const names = x.profiles.map((id) => profiles.find((p) => p.id === id)?.name ?? id);
  const src = iconSrc(x.icon);
  const name = x.name || x.ext_id;
  const add = async () => {
    try {
      // A Firefox add-on comes into the Firefox library from addons.mozilla.org, by its id.
      if (x.family === "firefox") await firefoxAddonImportUrl(x.ext_id);
      else await addProfileExtensionToLibrary(x);
      toast.ok(t("extensions.addedFromProfile", { name }));
    } catch (e) {
      toast.fail({ title: t("extensions.addFromProfileFailed", { name }), detail: e, subject: name });
    }
  };
  return (
    <article data-in-profile={x.ext_id} data-family={x.family} className="flex h-full w-full min-w-0 flex-col gap-2.5 rounded-tile px-cell py-[10px]">
      <div className="flex min-w-0 items-start gap-2.5">
        {src ? (
          <img src={src} alt="" className="size-[35px] shrink-0 rounded-control object-contain outline outline-1 -outline-offset-1 outline-stroke-image" />
        ) : (
          <div className="grid size-[35px] shrink-0 place-items-center rounded-control bg-bg-on-tile text-icon-sub-600">
            <NavExtensionsIcon className="size-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Tooltip content={name} whenTruncated><h2 className="m-0 truncate text-secondary font-medium text-text-strong-950">{name}</h2></Tooltip>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary text-text-soft-400">
            {x.version && <span className="truncate">v{x.version}</span>}
            <Badge size="small" color={x.family === "firefox" ? "warning" : "information"} className="shrink-0" data-family-badge>
              {x.family === "firefox" ? t("extensions.familyFirefox") : t("extensions.familyChromium")}
            </Badge>
          </div>
        </div>
      </div>
      <Tooltip content={names.join(", ")} whenTruncated>
        <p className="m-0 truncate text-secondary text-text-sub-600" data-in-profiles>
          {names.length === 1 ? t("extensions.inProfileOne", { name: names[0] }) : t("extensions.inProfileMany", { n: names.length })}
        </p>
      </Tooltip>
      <div className="mt-auto flex items-center justify-end gap-2">
        {inLibrary ? (
          <Badge size="small" color="success" data-in-library>{t("extensions.inLibrary")}</Badge>
        ) : (
          <Button variant="neutral" mode="stroke" size="xsmall" isLoading={adding} onClick={() => void add()}>
            {t("extensions.addToLibrary")}
          </Button>
        )}
      </div>
    </article>
  );
}

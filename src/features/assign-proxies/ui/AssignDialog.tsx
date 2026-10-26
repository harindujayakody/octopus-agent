import { useMemo, useState } from "react";
import { teamRefusal } from "../../../entities/space";
import { Button, Checkbox, DialogModal, EmptyState, SegmentControl, useLatched } from "@proxyshard/shardx-ui-kit";
import { RouteIcon } from "../../../shared/icons";
import { useNav } from "../../../shared/model/navigation";
import { WindowedRows } from "../../../shared/ui/WindowedRows";
import { ListStateCenter } from "../../../shared/ui/ListStates";
import { SelectField } from "../../../shared/ui/SelectField";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import {
  planAssignment, proxyMissing, selectVisible, useProfile,
  type AssignFrom, type AssignPlan, type ProfileMeta,
} from "../../../entities/profile";
import { useT } from "../../../shared/i18n";
import { SpreadProxyList } from "../../manage-profiles/ui/SpreadProxyList";

type T = ReturnType<typeof useT>;

/// The one Assign dialog (IFACE-03, O9b). From Profiles it asks which proxies
/// (or No proxy); from Proxies it asks which profiles. Both say what will
/// happen in one line, never share unless "Allow sharing" is on, and follow
/// the lists' order (PC-032). Failed binds are named by a toast, and the
/// selection is left as it is (R26 a).
export function AssignDialog({ open, from, onClose }: {
  open: boolean;
  from: AssignFrom;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // Held while the binds run: each row takes its new proxy at once, and the
  // lists, the preview and the button must not change under the spinner.
  const liveProfiles = useProfile((s) => s.profiles);
  const profiles = useLatched(busy ? null : liveProfiles) ?? liveProfiles;
  const proxies = useProfile((s) => s.proxies);
  const assignPairs = useProfile((s) => s.assignPairs);
  const [allowSharing, setAllowSharing] = useState(false);
  const [direct, setDirect] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [folder, setFolder] = useState("all");
  // Profiles without a proxy by default: handing proxies to profiles that
  // already have one is a deliberate re-shuffle.
  const [scope, setScope] = useState<"unbound" | "all">("unbound");
  const [unpicked, setUnpicked] = useState<Set<string>>(() => new Set());

  // Who uses each proxy now.
  const usedBy = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const p of profiles) if (p.proxy_id) (m[p.proxy_id] ??= []).push(p.id);
    return m;
  }, [profiles]);
  // The profiles the Proxies side can choose from: a Folder, and those
  // without a proxy (a deleted one counts as none) or all of them.
  const pool = useMemo(() => from.kind === "proxies"
    ? profiles.filter((p) => (folder === "all" || p.folder === pickedFolder(folder)) && (scope === "all" || !p.proxy_id || proxyMissing(p, proxies)))
    : [], [from.kind, profiles, proxies, folder, scope]);
  const poolIds = useMemo(() => listOrder(pool.map((p) => p.id), profiles), [pool, profiles]);
  const given = from.kind === "profiles" ? from.profileIds : null;
  const targetIds = useMemo(
    () => (given ? listOrder(given, profiles) : poolIds.filter((id) => !unpicked.has(id))),
    [given, profiles, poolIds, unpicked],
  );
  const targets = useMemo(() => new Set(targetIds), [targetIds]);
  // Proxies in the order their own list shows them: the Proxies list's when
  // opened from there, else the order of the proxy list.
  const proxyIds: (string | null)[] = from.kind === "proxies"
    ? from.proxyIds
    : direct ? [null] : proxies.filter((p) => picked.has(p.id)).map((p) => p.id);
  const plan = planAssignment(targetIds, proxyIds, { allowSharing, usedBy });
  // Profiles whose own proxy the plan takes away (for another one, or for No
  // proxy): the preview names them. A deleted proxy counts as none.
  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const replaced = plan.pairs.filter(({ profileId, proxyId }) => {
    const p = byId.get(profileId);
    return !!p?.proxy_id && p.proxy_id !== proxyId && !proxyMissing(p, proxies);
  }).length;
  const noProxies = from.kind === "profiles" && proxies.length === 0;
  const noCreate = !!teamRefusal("create");

  const run = async () => {
    setBusy(true);
    const ok = await assignPairs(plan.pairs);
    setBusy(false);
    if (ok) onClose();
  };

  const title = from.kind === "profiles"
    ? (from.profileIds.length === 1 ? t("assignProxies.titleOne") : t("assignProxies.title", { n: from.profileIds.length }))
    : (from.proxyIds.length === 1 ? t("assign.fromProxiesOne") : t("assign.fromProxiesMany", { n: from.proxyIds.length }));
  const dirty = allowSharing || (from.kind === "profiles"
    ? direct || picked.size > 0
    : unpicked.size > 0 || folder !== "all" || scope !== "unbound");

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      dirty={dirty}
      icon={<RouteIcon className="size-3.5" />}
      title={title}
      confirmLabel={t("assign.confirm", { n: plan.pairs.length })}
      onConfirm={run}
      isLoading={busy}
      isDisabled={busy || plan.pairs.length === 0}
      cancelLabel={t("assignProxies.cancel")}
      onCancel={onClose}
    >
      <div data-assign-dialog data-from={from.kind} className="flex flex-col gap-3 py-4">
        {noProxies ? (
          <div className="flex h-[240px] flex-col">
            <ListStateCenter>
              <EmptyState
                headingLevel={3}
                icon={<RouteIcon />}
                title={t("otherStates.noProxies")}
                // A team's member who may not add one is told whose they are, not sent to an empty page.
                hint={noCreate ? t("otherStates.noTeamProxiesHint") : undefined}
                actions={noCreate ? undefined : (
                  <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { onClose(); useNav.getState().setSection("proxies"); }}>
                    {t("otherStates.goToProxies")}
                  </Button>
                )}
              />
            </ListStateCenter>
          </div>
        ) : (
          <>
            {from.kind === "profiles" ? (
              <SpreadProxyList value={picked} onChange={setPicked} targets={targets} direct={direct} onDirect={setDirect} />
            ) : (
              <ProfileChoice
                profiles={profiles} folder={folder} setFolder={setFolder} scope={scope} setScope={setScope}
                shown={poolIds} unpicked={unpicked} setUnpicked={setUnpicked}
              />
            )}
            <Checkbox label={t("assign.allowSharing")} checked={allowSharing} disabled={direct} onChange={(e) => setAllowSharing(e.target.checked)} />
            <p data-assign-preview aria-live="polite" className="m-0 text-balance text-secondary text-text-sub-600">
              {previewOf(t, plan, { direct, asked: proxyIds.length > 0, targets: targetIds.length, replaced })}
            </p>
          </>
        )}
      </div>
    </DialogModal>
  );
}

/// Profiles in the Profiles list's order (PC-032); ones the list does not
/// show go last, by name.
function listOrder(ids: readonly string[], profiles: readonly ProfileMeta[]): string[] {
  const at = selectVisible().indexById;
  const name = new Map(profiles.map((p) => [p.id, p.name]));
  return [...ids].sort((a, b) => (at.get(a) ?? Infinity) - (at.get(b) ?? Infinity) || (name.get(a) ?? "").localeCompare(name.get(b) ?? ""));
}

/// One line that says what Assign will do. It also counts the proxies it
/// replaces, so giving proxies to profiles that have one is never a surprise;
/// with none replaced that part stays out.
function previewOf(t: T, plan: AssignPlan, { direct, asked, targets, replaced }: { direct: boolean; asked: boolean; targets: number; replaced: number }): string {
  const n = plan.pairs.length;
  if (direct) {
    const line = n === 1 ? t("assign.previewDirectOne") : t("assign.previewDirect", { n });
    return replaced > 0 ? `${line} ${t("assign.previewRemoves", { n: replaced })}` : line;
  }
  if (!asked) return t("assign.previewNone");
  if (targets === 0) return t("assign.previewNoProfiles");
  const parts: string[] = [];
  const proxiesUsed = Object.keys(plan.perProxy).length;
  const shared = Object.values(plan.perProxy).some((c) => c > 1);
  if (n === 0) parts.push(t("assign.previewNoPairs"));
  else if (shared) parts.push(proxiesUsed === 1 ? t("assign.previewShareOne", { n }) : t("assign.previewShare", { n, p: proxiesUsed }));
  else parts.push(n === 1 ? t("assign.previewGetOne") : t("assign.previewGet", { n }));
  if (replaced > 0) parts.push(t("assign.previewReplaces", { n: replaced }));
  // The ones left over are worth naming only when some got a proxy.
  if (n > 0 && plan.left.length > 0) parts.push(plan.left.length === 1 ? t("assign.previewLeftOne") : t("assign.previewLeft", { n: plan.left.length }));
  if (plan.skippedShared.length > 0) parts.push(plan.skippedShared.length === 1 ? t("assign.previewSkippedOne") : t("assign.previewSkipped", { n: plan.skippedShared.length }));
  return parts.join(" ");
}

/// The Proxies side's choice: which profiles, from a Folder, without a proxy
/// or all, each one a row that can be left out.
// A Folder's option carries a prefix, so a Folder named "all" is not Every folder.
const folderPick = (name: string) => `folder:${name}`;
const pickedFolder = (v: string) => (v.startsWith("folder:") ? v.slice(7) : null);

function ProfileChoice({ profiles, folder, setFolder, scope, setScope, shown, unpicked, setUnpicked }: {
  profiles: readonly ProfileMeta[];
  folder: string; setFolder: (v: string) => void;
  scope: "unbound" | "all"; setScope: (v: "unbound" | "all") => void;
  shown: string[];
  unpicked: Set<string>; setUnpicked: (s: Set<string>) => void;
}) {
  const t = useT();
  const folders = useMemo(() => [...new Set(profiles.map((p) => p.folder).filter(Boolean))].sort(), [profiles]);
  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label={t("proxyDistributeModal.profilesFrom")}
          value={folder}
          onChange={setFolder}
          isSearchable={folders.length > 8}
          options={[
            { value: "all", label: t("proxyDistributeModal.everyFolder") },
            ...folders.map((f) => ({ value: folderPick(f), label: f })),
          ]}
        />
        <FieldGroup label={t("proxyDistributeModal.applyTo")}>
          {(labelId) => (
            <SegmentControl
              // It filters the list under it, not a panel switch: a radio group.
              aria-labelledby={labelId}
              size="xsmall"
              className="w-full *:flex-1"
              value={scope}
              items={[
                { value: "unbound", label: t("proxyDistributeModal.scopeUnbound") },
                { value: "all", label: t("proxyDistributeModal.scopeAll") },
              ]}
              onChange={(v) => setScope(v as "unbound" | "all")}
            />
          )}
        </FieldGroup>
      </div>
      {/* Room for a checkbox's focus ring, which reaches 4 px past its box:
          the 8 px padding inside the box (owner rule). */}
      <WindowedRows
        className="flex max-h-[240px] flex-col gap-1.5 overflow-y-auto tile p-2"
        count={shown.length}
        estimate={26}
        keyOf={(i) => shown[i]}
        row={(i) => {
          const p = byId.get(shown[i])!;
          return (
            <Checkbox
              key={p.id}
              hitArea={false}
              wrapperClassName="flex w-full"
              label={p.name}
              checked={!unpicked.has(p.id)}
              onChange={(e) => {
                const next = new Set(unpicked);
                if (e.target.checked) next.delete(p.id); else next.add(p.id);
                setUnpicked(next);
              }}
            />
          );
        }}
      >
        {shown.length === 0 && (
          <p className="m-0 py-4 text-center text-balance text-secondary text-text-soft-400">{t("proxyDistributeModal.noMatches")}</p>
        )}
      </WindowedRows>
    </div>
  );
}

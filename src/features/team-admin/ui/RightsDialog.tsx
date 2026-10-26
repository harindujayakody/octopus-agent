import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DialogModal, SegmentControl, Select } from "@proxyshard/shardx-ui-kit";
import { LockedIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { LoadError, LoadingRows } from "../../../shared/ui/ListStates";
import {
  PRESET_IDS, RightsGrid, TEAM_ACTIONS, TeamFolderGlyph, applyPreset, presetOf, sameGrants, scopeKey, sortGrants, teamCall, teamError, useTeamAdmin,
  type Grant, type Preset, type RightsRow, type TeamMember,
} from "../../../entities/team";

/// One member's rights, edited as a grid and saved as one list. The presets
/// fill the row in hand; the line under the grid says what wins.
export function RightsDialog({ member, open, onClose }: { member: TeamMember; open: boolean; onClose: () => void }) {
  const t = useT();
  const teamId = useTeamAdmin((s) => s.teamId);
  const overview = useTeamAdmin((s) => s.overview);
  const saveGrants = useTeamAdmin((s) => s.saveGrants);
  const [loaded, setLoaded] = useState<Grant[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Grant[]>([]);
  // Profiles given a row in this session, before any rule is set on them.
  const [added, setAdded] = useState<string[]>([]);
  const [selected, setSelected] = useState("team");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const presetsId = useId();

  // Only the last read lands: an earlier one (the dev double mount, a Retry)
  // must never put back rules over cells already changed.
  const req = useRef(0);
  const load = () => {
    if (!teamId) return;
    const mine = ++req.current;
    setLoadErr(null);
    teamCall("team_admin_grants", { teamId, memberId: member.id })
      .then((g) => { if (mine === req.current) { setLoaded(g); setDraft(g); } })
      .catch((e) => { if (mine === req.current) setLoadErr(teamError(e)); });
  };
  useEffect(() => {
    load();
    return () => { req.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const dirty = loaded !== null && !sameGrants(draft, loaded);
  const folders = overview?.folders ?? [];
  const profiles = overview?.profiles ?? [];

  const rows = useMemo((): RightsRow[] => {
    const out: RightsRow[] = [{ scope: { kind: "team" }, label: t("team.wholeTeam"), target: {} }];
    const folderNames = folders.map((f) => f.name);
    // A rule may name a folder the list no longer has: it still shows, to be cleared.
    for (const g of draft) if (g.scope.kind === "folder" && g.scope.name !== "" && !folderNames.includes(g.scope.name)) folderNames.push(g.scope.name);
    for (const name of folderNames) {
      const f = folders.find((x) => x.name === name);
      out.push({ scope: { kind: "folder", name }, label: name, lead: <TeamFolderGlyph color={f?.color ?? ""} />, target: { folder: name } });
    }
    // The profiles in no folder are one place too, as team-model's folder("") rule.
    if (profiles.some((p) => p.folder === "") || draft.some((g) => g.scope.kind === "folder" && g.scope.name === "")) {
      out.push({ scope: { kind: "folder", name: "" }, label: t("team.noFolder"), lead: <TeamFolderGlyph color="" />, target: { folder: "" } });
    }
    const ids: string[] = [];
    for (const g of draft) if (g.scope.kind === "profile" && !ids.includes(g.scope.id)) ids.push(g.scope.id);
    for (const id of added) if (!ids.includes(id)) ids.push(id);
    for (const id of ids) {
      const p = profiles.find((x) => x.id === id);
      out.push({
        scope: { kind: "profile", id },
        label: p?.name ?? id,
        hint: p ? p.folder || t("team.noFolder") : undefined,
        target: p ? { profileId: id, folder: p.folder } : null,
        removable: true,
      });
    }
    return out;
  }, [draft, added, folders, profiles, t]);

  const shownIds = new Set(rows.flatMap((r) => (r.scope.kind === "profile" ? [r.scope.id] : [])));
  const pickable = profiles.filter((p) => !shownIds.has(p.id));
  const row = rows.find((r) => scopeKey(r.scope) === selected) ?? rows[0];
  const preset = presetOf(draft, row.scope);
  const presetName = (p: Preset) =>
    p === "none" ? t("team.presetNone") : p === "view" ? t("team.presetView") : p === "run" ? t("team.presetRun") : p === "edit" ? t("team.presetEdit") : t("team.presetFull");

  const save = async () => {
    if (!teamId || busy) return;
    if (!dirty) { onClose(); return; }
    setBusy(true);
    setErr(null);
    try {
      const saved = await saveGrants(member.id, sortGrants(draft, TEAM_ACTIONS));
      setLoaded(saved);
      setDraft(saved);
      toast.saved(t("team.rightsSaved", { name: member.name }));
      onClose();
    } catch (e) {
      setErr(teamError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      icon={<LockedIcon className="size-3.5" />}
      title={t("team.rightsTitle", { name: member.name })}
      subtitle={member.active ? t("team.rightsSubtitle") : t("team.rightsSubtitleOff")}
      confirmLabel={t("team.rightsSave")}
      onConfirm={() => void save()}
      isLoading={busy}
      isDisabled={loaded === null}
      footerNote={err ? <span role="alert" data-rights-error className="text-error-text">{err}</span> : undefined}
    >
      <div className="flex flex-col gap-3 py-4">
        {loadErr ? (
          <LoadError what={t("team.rightsWhat")} error={loadErr} onRetry={load} headingLevel={3} />
        ) : loaded === null ? (
          <LoadingRows rows={4} rowHeight={36} />
        ) : (
          <>
            <div data-presets className="flex flex-wrap items-center gap-2">
              <span id={presetsId} className="min-w-0 truncate text-secondary text-text-sub-600">{t("team.presetsFor", { where: row.label })}</span>
              <SegmentControl
                aria-labelledby={presetsId}
                size="xsmall"
                fit
                value={preset ?? ""}
                items={PRESET_IDS.map((p) => ({ value: p, label: presetName(p) }))}
                onChange={(v) => setDraft((d) => applyPreset(d, row.scope, v as Preset))}
              />
            </div>
            <RightsGrid
              editable
              autoFocus
              label={t("team.rightsTitle", { name: member.name })}
              rows={rows}
              grants={draft}
              selected={scopeKey(row.scope)}
              onSelectRow={(r) => setSelected(scopeKey(r.scope))}
              onChange={setDraft}
              onRemoveRow={(r) => {
                if (r.scope.kind !== "profile") return;
                const id = r.scope.id;
                setDraft((d) => d.filter((g) => !(g.scope.kind === "profile" && g.scope.id === id)));
                setAdded((a) => a.filter((x) => x !== id));
                if (selected === scopeKey(r.scope)) setSelected("team");
              }}
            />
            {pickable.length > 0 && (
              <div className="w-[260px]">
                <Select
                  size="xsmall"
                  aria-label={t("team.addProfileRule")}
                  placeholder={t("team.addProfileRule")}
                  searchPlaceholder={t("team.findProfile")}
                  isSearchable={pickable.length > 8}
                  value=""
                  options={pickable.map((p) => ({ value: p.id, label: p.name, hint: p.folder || undefined }))}
                  onChange={(id) => { setAdded((a) => [...a, id]); setSelected(`profile:${id}`); }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </DialogModal>
  );
}

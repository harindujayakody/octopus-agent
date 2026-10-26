import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Checkbox, IconButton, Modal, Select, Textarea, Tooltip } from "@proxyshard/shardx-ui-kit";
import { RefreshIcon } from "../../../shared/icons";
import { CountryFlag } from "../../../shared/ui/CountryFlag";
import { ProxyKind } from "../../../shared/ui/ProxyAddress";
import { WindowedRows } from "../../../shared/ui/WindowedRows";
import { toast } from "../../../shared/model/toast";
import { useT } from "../../../shared/i18n";
import type { ProxyEntry, BulkRowState } from "../../../entities/proxy";
import { proxyBulkParse, proxyBulkSave, proxyFullTest, proxyStatus, sameProxy, useProxy } from "../../../entities/proxy";

/// `onClose` gets the id of the proxy saved when it was the only one, for the
/// page to open in Peek.
export function ProxyBulkImporter({ open, onClose }: { open: boolean; onClose: (added?: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ProxyEntry["kind"]>("socks5");
  const [rows, setRows] = useState<BulkRowState[]>([]);
  const [busy, setBusy] = useState(false);
  // A second press while the first is saving would save it again.
  const adding = useRef(false);
  // Closed while Add saved (Esc, the backdrop, Cancel): the proxies are
  // still added, but no Peek opens for a dialog the person already left.
  const openRef = useRef(open);
  openRef.current = open;

  const parse = async () => {
    if (!text.trim()) { toast.err(t("proxyBulkImporter.nothingToParse")); return; }
    try {
      const parsed = await proxyBulkParse(text, kind);
      if (parsed.length === 0) { toast.err(t("proxyBulkImporter.noValidLines")); return; }
      setRows(parsed.map((e) => ({ entry: e, selected: true, status: "idle" })));
    } catch (e) { toast.fail({ title: t("proxyBulkImporter.previewFailed"), detail: e }); }
  };

  // Test results wait in a buffer and reach the rows once per frame: "Test
  // all" over 1,000 lines renders about once a frame, not once per result
  // over every row (PERF-19).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pending = useRef(new Map<number, Partial<BulkRowState>>());
  const frame = useRef(0);
  const put = useCallback((idx: number, patch: Partial<BulkRowState>) => {
    pending.current.set(idx, { ...pending.current.get(idx), ...patch });
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const batch = pending.current;
      pending.current = new Map();
      setRows((rs) => rs.map((r, i) => (batch.has(i) ? { ...r, ...batch.get(i) } : r)));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const testOne = useCallback(async (idx: number) => {
    const entry = rowsRef.current[idx]?.entry;
    if (!entry) return;
    put(idx, { status: "testing" });
    try {
      const snap = await proxyFullTest(entry);
      put(idx, {
        status: proxyStatus(snap) === "ok" ? "ok" : "fail",
        tcp_ms: snap.tcp_ms,
        udp_ms: snap.udp_ms,
        country: snap.country_code || rowsRef.current[idx]?.country,
        entry: { ...entry, country: snap.country_code || entry.country },
      });
    } catch (e) {
      put(idx, { status: "fail", error: String(e) });
    }
  }, [put]);

  const toggle = useCallback((idx: number) => {
    setRows((rs) => rs.map((x, j) => (j === idx ? { ...x, selected: !x.selected } : x)));
  }, []);

  const testAll = async () => {
    setBusy(true);
    const CONCURRENCY = 5;
    const queue = rows.map((_, i) => i);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (cursor < queue.length) {
          const i = queue[cursor++];
          if (i == null) break;
          await testOne(i);
        }
      }),
    );
    setBusy(false);
  };

  // Every paste goes through the preview first, one line too, so a proxy
  // can be tested before it is added. One proxy added opens in Peek, as New
  // profile does (CRAFT-26); several say how many in a toast.
  const saveSelected = async () => {
    if (adding.current) return;
    const entries = rows.filter((r) => r.selected).map((r) => r.entry);
    if (entries.length === 0) { toast.err(t("proxyBulkImporter.nothingSelected")); return; }
    adding.current = true;
    setBusy(true);
    try {
      const n = await proxyBulkSave(entries);
      await useProxy.getState().reload();
      // The entry keeps the id it was parsed with; one the save skipped (an
      // identical proxy was already there) opens that proxy instead. Never
      // by host, port and user alone: several proxies can share them and
      // differ by password (a session in it).
      let added: string | undefined;
      if (entries.length === 1) {
        const [entry] = entries;
        const { proxies } = useProxy.getState();
        added = (proxies.find((p) => p.id === entry.id) ?? proxies.find((p) => sameProxy(p, entry)))?.id;
      }
      // Several, one not in the list read back, or the dialog already gone:
      // say how many, rather than end with nothing to show for it.
      if (!added || !openRef.current) toast.ok(n === 1 ? t("proxyBulkImporter.importedOne", { n }) : t("proxyBulkImporter.importedMany", { n }));
      if (openRef.current) onClose(added);
    } catch (e) { toast.fail({ title: t("proxyBulkImporter.addFailed"), detail: e }); }
    finally {
      adding.current = false;
      setBusy(false);
    }
  };

  const allSel = rows.length > 0 && rows.every((r) => r.selected);
  const selCount = rows.filter((r) => r.selected).length;

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={t("proxyBulkImporter.title")}
      size="lg"
      // Pasted lines or parsed rows: Esc and the backdrop ask first (IFACE-08).
      dirty={text.trim() !== "" || rows.length > 0}
      footer={
        <div className="flex items-center justify-end gap-2">
          {/* Cancel cannot stop a save that has started (Esc and the backdrop close without a Peek). */}
          <Button variant="neutral" mode="stroke" size="xsmall" disabled={busy && rows.length === 0} onClick={() => onClose()}>{t("proxyBulkImporter.cancel")}</Button>
          {rows.length === 0 ? (
            <Button variant="primary" mode="filled" size="xsmall" disabled={busy} onClick={parse}>
              {t("proxyBulkImporter.parse")}
            </Button>
          ) : (
            <Button variant="primary" mode="filled" size="xsmall" onClick={saveSelected}>
              {selCount === 1 ? t("proxyBulkImporter.importCountOne") : t("proxyBulkImporter.importCount", { n: selCount })}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex min-h-0 flex-col gap-3">
        {rows.length === 0 ? (
          <>
            <Select
              label={t("proxyBulkImporter.defaultTypeLabel")}
              size="xsmall"
              value={kind}
              onChange={(v) => setKind(v as ProxyEntry["kind"])}
              options={[
                { value: "socks5", label: "SOCKS5" },
                { value: "http", label: "HTTP" },
                { value: "https", label: "HTTPS" },
              ]}
            />
            <Textarea
              label={t("proxyBulkImporter.pasteLabel")}
              rows={12}
              className="mono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("proxyBulkImporter.pastePlaceholder")}
            />
            <p className="m-0 text-secondary text-text-soft-400">
              {t("proxyBulkImporter.duplicatesNote")}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 pb-1.5">
              <Checkbox
                checked={allSel}
                label={t("proxyBulkImporter.selectedCount", { n: selCount, total: rows.length })}
                onChange={(e) =>
                  setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))
                }
              />
              <div className="ml-auto flex gap-1.5">
                <Button variant="neutral" mode="stroke" size="3xsmall" onClick={() => setRows([])}>{t("proxyBulkImporter.back")}</Button>
                <Button
                  variant="neutral"
                  mode="stroke"
                  size="3xsmall"
                  leftIcon={<RefreshIcon className="size-3.5" />}
                  onClick={testAll}
                  disabled={busy}
                  isLoading={busy}
                >
                  {busy ? t("proxyBulkImporter.testingAll") : t("proxyBulkImporter.testAll")}
                </Button>
                <Tooltip content={t("proxyBulkImporter.keepWorkingHint")}>
                  <Button
                    variant="neutral"
                    mode="stroke"
                    size="3xsmall"
                    onClick={() =>
                      setRows((rs) =>
                        rs.map((r) => ({ ...r, selected: r.status === "ok" }))
                      )
                    }
                  >
                    {t("proxyBulkImporter.keepWorkingOnly")}
                  </Button>
                </Tooltip>
              </div>
            </div>
            <WindowedRows
              className="max-h-[380px] overflow-y-auto py-2  overflow-x-hidden tile"
              count={rows.length}
              estimate={37}
              row={(i) => (
                <ImportRow key={`${rows[i].entry.host}:${rows[i].entry.port}:${i}`} r={rows[i]} i={i} onToggle={toggle} onTest={testOne} />
              )}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

/// One parsed line. Memoized: a flush of results renders only the lines that changed.
const ImportRow = memo(function ImportRow({ r, i, onToggle, onTest }: {
  r: BulkRowState;
  i: number;
  onToggle: (i: number) => void;
  onTest: (i: number) => void;
}) {
  const t = useT();
  return (
    <div
      // A click anywhere on the row toggles its box, once (owner).
      onClick={(e) => { if (!(e.target as HTMLElement).closest("label,input,button,a,select")) onToggle(i); }}
      data-filled={r.status === "ok" || r.status === "fail" ? "" : undefined}
      className={`import-cols row-line row-line-hover relative cursor-pointer px-cell py-1.5 text-secondary${r.status === "ok" ? " bg-success-alpha-16/20" : r.status === "fail" ? " bg-error-alpha-16/20 opacity-85" : ""}`}
    >
      <Checkbox
        checked={r.selected}
        aria-label={t("proxyBulkImporter.selectRow", { host: `${r.entry.host}:${r.entry.port}` })}
        onChange={() => onToggle(i)}
      />
      {/* Owner feedback 5n: the same 12 px, muted look every
          other type+address pairing uses, not a colored badge —
          type and address stay one look everywhere they show. */}
      <ProxyKind kind={r.entry.kind} />
      <Tooltip content={`${r.entry.host}:${r.entry.port}${r.entry.username ? " @" + r.entry.username : ""}`}>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-mono text-text-sub-600">
          {r.entry.host}:{r.entry.port}
          {r.entry.username && <span className="text-text-soft-400">, {r.entry.username}</span>}
        </span>
      </Tooltip>
      <div className="inline-flex items-center justify-end gap-1.5">
        {r.status === "idle" && <span className="text-text-soft-400">{t("proxyBulkImporter.notTested")}</span>}
        {r.status === "testing" && <span className="text-text-soft-400">{t("proxyBulkImporter.testingRow")}</span>}
        {r.status === "ok" && (
          <>
            <Tooltip content={t("proxyBulkImporter.tcpTime", { ms: String(r.tcp_ms) })}><Badge color="success" size="small">{t("proxyBulkImporter.active")}</Badge></Tooltip>
            {r.entry.kind === "socks5" && r.udp_ms != null && (
              <Tooltip content={t("proxyBulkImporter.udpRelayWorks", { ms: r.udp_ms })}><Badge color="primary" size="small">UDP</Badge></Tooltip>
            )}
            {r.country && (
              <>
                <CountryFlag cc={r.country} />
                <span className="text-text-sub-600">{r.country}</span>
              </>
            )}
          </>
        )}
        {r.status === "fail" && (
          <Tooltip content={r.error}><Badge color="error" size="small">{t("proxyBulkImporter.failed")}</Badge></Tooltip>
        )}
      </div>
      <IconButton variant="neutral" mode="stroke" size="3xsmall" onClick={() => onTest(i)} disabled={r.status === "testing"} icon={<RefreshIcon className="size-3.5" />} label={t("proxyBulkImporter.testRow")} />
    </div>
  );
});

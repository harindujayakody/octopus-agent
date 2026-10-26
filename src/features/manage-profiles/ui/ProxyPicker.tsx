import { useRef, useState } from "react";
import { Combobox } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { storeBus } from "../../../shared/lib/storeBus";
import { proxyBulkParse, proxySave, type ProxyEntry } from "../../../entities/proxy";
import { useProfile } from "../../../entities/profile";
import { teamRefusal, useRightsChange } from "../../../entities/space";
import { useProxyOptions } from "./ProxySelect";

/** A query that reads as a proxy line (host:port, a URL, user:pass@host):
 *  only then is "Add proxy “…”" offered, so a plain search never ends in it. */
const looksLikeLine = (q: string) => /\S:\d{1,5}(?!\d)/.test(q) || q.includes("://") || /\S@\S/.test(q);

/// A profile's proxy as a search over a list (IFACE-04): the current one
/// highlighted, type a name, a host or a country, the arrows, Enter binds. A
/// pasted proxy line that matches nothing is the last row: "Add proxy “…”"
/// saves it and binds it.
export function ProxyPicker({ value, proxies, onPick }: {
  value: string | null;
  proxies: ProxyEntry[];
  onPick: (id: string | null) => void;
}) {
  const t = useT();
  const options = useProxyOptions(proxies, value);
  useRightsChange();
  const [query, setQuery] = useState("");
  const adding = useRef(false);
  const add = async (line: string) => {
    if (adding.current) return;
    adding.current = true;
    try {
      const [parsed] = await proxyBulkParse(line, "socks5");
      if (!parsed) { toast.fail({ title: t("proxySelect.parseFailed") }); return; }
      const saved = await proxySave(parsed);
      // The Proxies page keeps its own copy of the list; the profile store
      // reads its own just below.
      storeBus.emit("proxies", "profiles");
      // The picker's list is the profile store's copy: it holds the new proxy before it is bound.
      await useProfile.getState().reload();
      onPick(saved.id);
    } catch (e) {
      toast.fail({ title: t("proxyPicker.addFailed"), detail: e });
    } finally {
      adding.current = false;
    }
  };
  return (
    <Combobox
      aria-label={t("profileRow.proxyLabel")}
      placeholder={t("proxySelect.searchPlaceholder")}
      options={options}
      value={value ?? ""}
      query={query}
      onQueryChange={setQuery}
      onChange={(id) => onPick(id || null)}
      // A team's new proxy needs Create on it (doors.rs proxy_save).
      onCreate={looksLikeLine(query.trim()) && !teamRefusal("create") ? (line) => { void add(line); } : undefined}
      createLabel={(line) => t("proxyPicker.add", { line })}
      emptyText={t("proxySelect.noMatches")}
    />
  );
}

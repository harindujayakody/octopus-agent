import { useState } from "react";
import { countActiveProxyFilters, useProxy } from "../../../entities/proxy";
import { FilterMenu } from "../../../shared/ui/filters";
import { useT } from "../../../shared/i18n";
import { useProxyFilterFields } from "../lib/filterFields";

/** Filters for the Proxies list (O8): status, used by, type, country. */
export function ProxyFilterBar() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const filters = useProxy((s) => s.filters);
  const fields = useProxyFilterFields(open);
  return <FilterMenu open={open} onOpenChange={setOpen} fields={fields} activeCount={countActiveProxyFilters(filters)} label={t("profileFilterBar.filters")} />;
}

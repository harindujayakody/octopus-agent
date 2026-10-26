import { useState, type ReactNode } from "react";
import { IconButton } from "@proxyshard/shardx-ui-kit";
import { EyeIcon, EyeOffIcon } from "../../shared/icons";
import { CountryFlag } from "../../shared/ui/CountryFlag";
import { PropertyRow, PropertySheet, PropertyValue } from "../../shared/ui/peek";
import { useT } from "../../shared/i18n";
import type { ProxyEntry } from "../../entities/proxy";

const KIND = { socks5: "SOCKS5", http: "HTTP", https: "HTTPS" } as const;

/// A proxy's details, read: label and value rows, as the profile panel's.
/// Nothing here changes the proxy; Edit in the header opens the dialog where
/// it is changed and saved by hand. The password is dots until the eye shows
/// it (and then it is on the screen, not just in the page).
export function Details({ proxy: p }: { proxy: ProxyEntry }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const none = t("proxyPeek.none");
  const row = (id: string, label: string, value: ReactNode, opts: { empty?: boolean; wrap?: boolean; mono?: boolean; selectable?: boolean } = {}) => (
    <PropertyRow id={id} label={label}>
      {() => (
        <PropertyValue empty={opts.empty} wrap={opts.wrap}>
          <span {...(opts.selectable ? { "data-selectable": "" } : {})} className={opts.mono ? "mono min-w-0 truncate" : opts.wrap ? "min-w-0 whitespace-pre-wrap break-words" : "min-w-0 truncate"}>{value}</span>
        </PropertyValue>
      )}
    </PropertyRow>
  );
  return (
    <PropertySheet>
      {/* 2 px between 32 px rows, as the profile panel's. */}
      <div className="flex flex-col gap-[2px]">
        {row("type", t("proxyEditor.typeLabel"), KIND[p.kind])}
        {row("host", t("proxyEditor.hostLabel"), p.host, { mono: true, selectable: true })}
        {row("port", t("proxyEditor.portLabel"), p.port, { mono: true, selectable: true })}
        {row("username", t("proxyEditor.usernameLabel"), p.username || none, { empty: !p.username, selectable: !!p.username })}
        <PropertyRow id="password" label={t("proxyEditor.passwordLabel")}>
          {() => (
            <>
              <PropertyValue empty={!p.password}>
                {!p.password ? <span className="truncate">{none}</span>
                  : shown ? <span data-selectable className="mono min-w-0 truncate">{p.password}</span>
                  : <span aria-hidden="true" className="min-w-0 truncate">••••••••</span>}
              </PropertyValue>
              {p.password && (
                // One name, "Show password"; whether it is shown is `aria-pressed` (PC-073).
                <IconButton
                  size="3xsmall"
                  label={t("proxyPeek.showPassword")}
                  aria-pressed={shown}
                  icon={shown ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
                  onClick={() => setShown((v) => !v)}
                />
              )}
            </>
          )}
        </PropertyRow>
        <PropertyRow id="country" label={t("proxyEditor.countryLabel")}>
          {() => (
            <PropertyValue empty={!p.country}>
              {p.country ? (
                <>
                  <CountryFlag cc={p.country} height={14} />
                  <span className="truncate">{p.country}</span>
                </>
              ) : <span className="truncate">{none}</span>}
            </PropertyValue>
          )}
        </PropertyRow>
        {row("notes", t("proxyPeek.notes"), p.notes || t("peek.noNotes"), { empty: !p.notes, wrap: true, selectable: !!p.notes })}
      </div>
    </PropertySheet>
  );
}

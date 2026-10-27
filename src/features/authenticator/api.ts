import { invoke } from "../../shared/api/invoke";

/** A saved account and its code now (authenticator.rs `Shown`). */
export type TotpAccount = {
  id: string;
  label: string;
  issuer: string;
  profile_id: string | null;
  code: string;
  /** Seconds until the code changes. */
  remaining: number;
  period: number;
};

/** One line of the quick box (authenticator.rs `Quick`). */
export type TotpQuick = { label: string; code: string | null; remaining: number; period: number; error: string | null };

/** What Add sends: a Base32 secret or an `otpauth://` link, and a name. */
export type NewTotpAccount = { label: string; issuer: string; secret: string; profile_id: string | null };

export const totpList = () => invoke<TotpAccount[]>("totp_list");
export const totpAdd = (account: NewTotpAccount) => invoke<TotpAccount>("totp_add", { account });
export const totpRemove = (id: string) => invoke<void>("totp_remove", { id });
/** Codes for pasted secrets; nothing is saved. */
export const totpQuick = (lines: string[]) => invoke<TotpQuick[]>("totp_quick", { lines });

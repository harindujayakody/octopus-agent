import { useState } from "react";
import { Input } from "@proxyshard/shardx-ui-kit";
import { KeyIcon } from "../../../shared/icons";
import { splitInvite } from "../lib/invite";

export type InviteState = ReturnType<typeof useInvite>;

/** A server address and a token; a whole invite pasted in either fills both. */
export function useInvite(onEdit?: () => void, startServer = "") {
  const [server, setServer] = useState(startServer);
  const [token, setToken] = useState("");
  const take = (text: string, into: (v: string) => void) => {
    onEdit?.();
    const inv = splitInvite(text);
    if (inv) { setServer(inv.server); setToken(inv.token); } else into(text);
  };
  return {
    server,
    token,
    ready: server.trim() !== "" && token.trim() !== "",
    // The address it opened with is not an edit: closing then asks nothing.
    dirty: server.trim() !== startServer.trim() || token.trim() !== "",
    setServer: (text: string) => take(text, setServer),
    setToken: (text: string) => take(text, setToken),
  };
}

/// The invite's two fields, as Join a team, the Create a team guide and Sync show them.
export function InviteFields({ invite, serverLabel, tokenLabel, placeholder, autoFocus }: {
  invite: InviteState;
  serverLabel: string;
  tokenLabel: string;
  placeholder: string;
  /** The field that takes the keyboard as it opens. */
  autoFocus?: "server" | "token";
}) {
  return (
    <>
      <Input
        inputSize="xsmall"
        label={serverLabel}
        placeholder={placeholder}
        className="mono"
        autoFocus={autoFocus === "server"}
        value={invite.server}
        onChange={(e) => invite.setServer(e.target.value)}
      />
      <Input
        inputSize="xsmall"
        label={tokenLabel}
        secret
        type="password"
        leftIcon={<KeyIcon className="size-3.5" />}
        // A dialog's trap would put the keyboard on the first field otherwise.
        data-autofocus={autoFocus === "token" ? "" : undefined}
        autoFocus={autoFocus === "token"}
        value={invite.token}
        onChange={(e) => invite.setToken(e.target.value)}
      />
    </>
  );
}

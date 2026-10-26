/** An invite is the server's address and the token after a "#", as the Team page copies it. */
export function splitInvite(text: string): { server: string; token: string } | null {
  const s = text.trim();
  const at = s.search(/#(stm_|eyJ)/);
  return at > 0 ? { server: s.slice(0, at), token: s.slice(at + 1) } : null;
}

/** An address typed without a scheme is plain http, as a team server on an IP serves. */
export const withScheme = (server: string): string => {
  const s = server.trim();
  return s === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
};

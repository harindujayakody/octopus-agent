// The team server as the release publishes it: the guide's commands name these.
// Neither is published yet; release.yml has to build and push them under these names.
export const TEAM_SERVER_IMAGE = "ghcr.io/harindujayakody/octopus-agent-team-server:latest";
export const TEAM_SERVER_BINARY = "octopus-agent-team-server";
export const TEAM_SERVER_PORT = 8787;
/** The container's name in the Docker command, which `docker logs` reads back. */
export const TEAM_SERVER_CONTAINER = "shardbrowser-team";

/** A value as one shell word: single quotes, and a quote inside closed and reopened. */
const sh = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
/** The same for PowerShell, which doubles a quote inside. */
const ps = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function dockerCommand(name: string): string {
  const n = name.trim();
  return [
    `docker run -d --name ${TEAM_SERVER_CONTAINER} --restart unless-stopped -p ${TEAM_SERVER_PORT}:${TEAM_SERVER_PORT} -v shardbrowser-team:/data`,
    n && `-e SHARDBROWSER_TEAM_NAME=${sh(n)}`,
    `-e SHARDBROWSER_TEAM_BIND=0.0.0.0:${TEAM_SERVER_PORT} -e SHARDBROWSER_TEAM_DATA_DIR=/data ${TEAM_SERVER_IMAGE}`,
  ].filter(Boolean).join(" ");
}

export const dockerLogsCommand = () => `docker logs ${TEAM_SERVER_CONTAINER}`;

/** The downloaded program, started from the folder it is in. */
export function binaryCommand(name: string, os: "unix" | "windows"): string {
  const n = name.trim();
  if (os === "windows") {
    return [
      n && `$env:SHARDBROWSER_TEAM_NAME=${ps(n)};`,
      `$env:SHARDBROWSER_TEAM_BIND='0.0.0.0:${TEAM_SERVER_PORT}'; $env:SHARDBROWSER_TEAM_DATA_DIR='.\\team-data'; .\\${TEAM_SERVER_BINARY}.exe`,
    ].filter(Boolean).join(" ");
  }
  return [
    `chmod +x ./${TEAM_SERVER_BINARY} &&`,
    n && `SHARDBROWSER_TEAM_NAME=${sh(n)}`,
    `SHARDBROWSER_TEAM_BIND=0.0.0.0:${TEAM_SERVER_PORT} SHARDBROWSER_TEAM_DATA_DIR=./team-data ./${TEAM_SERVER_BINARY}`,
  ].filter(Boolean).join(" ");
}

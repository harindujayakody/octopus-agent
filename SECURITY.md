# Security policy

Octopus Agent handles fingerprints, proxies, cookies and saved passwords, and
ships a team and sync server and an MCP server that drives browsers. Please
report security problems privately, not in a public issue.

## Report a vulnerability

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/harindujayakody/octopus-agent/security/advisories/new)
(the *Security* tab, then *Report a vulnerability*).

Please include:

* the version (*Settings › About*, or the release tag) and your OS;
* which part is affected: launcher, team or sync server, MCP server, an SDK,
  or the release and update pipeline;
* steps to reproduce, and what an attacker gains.

## What to expect

* An acknowledgement within 3 working days.
* A first assessment within 10 working days.
* A fix in a patch release as soon as it is ready. Every installed launcher is
  offered it through the signed auto-update.
* Credit in the release notes, unless you prefer not to be named.

Please give us a reasonable time to ship a fix before you disclose the
problem publicly.

## Supported versions

Only the latest release gets security fixes. The launcher updates itself, so
update first and check that the problem is still there.

## In scope

* The launcher (`src/`, `src-tauri/`) and its local HTTP API.
* The team and sync server (`team-server/`, `crates/`): authentication,
  invites, permissions, data at rest.
* The MCP server (`mcp/`) and the SDKs (`sdks/`).
* The release workflow and the auto-update signing.

## Out of scope

* Websites detecting that a profile is an anti-detect browser. Report that as
  a normal bug.
* Problems that need an attacker who already controls your computer or your
  user account.
* The upstream Chromium engine: report those to the
  [Chromium project](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/).
* Findings from automated scanners with no demonstrated impact.

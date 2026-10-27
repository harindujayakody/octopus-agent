# Set up cloud sync

Octopus Agent can keep your profiles the same on every computer you use, for
example a Windows PC at the office and a Mac at home. The computers meet on a
sync server that you run yourself. Nothing goes through anyone else’s
infrastructure: the server, its database and your profiles’ sessions stay on
a machine you control.

The sync server is the same program as the team server. One server can do
both: carry your own profiles between your computers (personal sync) and hold
a team’s shared profiles (team spaces). This guide is about personal sync; the
team side is covered in the README under
[Team spaces and sync (self-hosted)](../README.md#5-team-spaces-and-sync-self-hosted).

Contents:

* [What sync does](#what-sync-does)
* [Security model](#security-model)
* [Where to run the server](#where-to-run-the-server)
* [Run the server with Docker](#run-the-server-with-docker)
* [Run the server as a program](#run-the-server-as-a-program)
* [Connect your first computer](#connect-your-first-computer)
* [Add another computer](#add-another-computer)
* [Choose what syncs](#choose-what-syncs)
* [Use a profile on two computers safely](#use-a-profile-on-two-computers-safely)
* [Windows, macOS and Linux together](#windows-macos-and-linux-together)
* [Update the server](#update-the-server)
* [Back up and restore the server](#back-up-and-restore-the-server)
* [Troubleshooting](#troubleshooting)

---

## What sync does

When sync is on, each computer keeps its own full copy of your data, as it
always did, and mirrors it to your space on the server. Changes go up a moment
after you make them and come down to your other computers at their next sync
(about once a minute, sooner when the server tells them something changed).
**Settings › Sync › Sync now** runs one straight away.

### What travels

You choose these in **Settings › Sync** under **What syncs**:

* **Profiles**, with their sessions: cookies, site data and saved passwords.
  All of them, or only the ones you pick.
* **Proxies**: all of them, or only the ones assigned to synced profiles.
* **Folders and tags**, with their colors.
* **Bookmarks**.
* **Extensions**, with their files.
* **Automation projects**.

A profile’s session is packed when its browser closes and unpacked before it
starts on another computer. It carries what keeps you signed in and where you
left off:

* cookies and saved passwords, in a portable form (see
  [Windows, macOS and Linux together](#windows-macos-and-linux-together));
* local storage, session storage, IndexedDB and other site storage;
* history, the browser’s own bookmarks, autofill data and the open tabs;
* extensions’ state and settings, and the browser’s preferences.

### What does not travel

* **Caches.** The disk cache, code cache, GPU cache and service worker
  caches are never packed. The browser fills them again on the next start.
* **Launcher settings** (everything under **Settings** that is not on the
  Sync tab) and the **fingerprint library** stay on each computer.
* **Secret values in automation steps** never leave the computer they were
  typed on. The project travels; the secret values have to be typed again on
  each computer.

### Size limit

The server keeps a profile’s session up to 256 MB. If a session is bigger,
Octopus Agent leaves out site storage first (IndexedDB, file system storage,
service workers and web databases), the largest site first, until the rest
fits. Cookies, passwords and everything else stay. If it still does not fit,
the session is not sent and the error says
`the session is … MB, more than the 252 MB the server keeps`.

---

## Security model

**The connection is encrypted, without a certificate or domain.** The app
reaches the server at a plain `http://` address, then switches the connection
to TLS with the server’s own key. On the first connection the server has to
prove that it issued the token in your invite; from then on the app remembers
the server’s key and refuses a server that shows another one. Only
`GET /health` answers unencrypted, and it says nothing beyond “the server is
up” and the team’s id. Plain http on an IP address is fine, also over the
internet.

**The database is encrypted at rest.** Profiles, proxies, sessions and items
are sealed with a key kept in `server.key`, beside the database
`team.sqlite`. On Linux and macOS the data folder is made readable only by the
account the server runs as; on Windows it is limited to that account, SYSTEM
and Administrators. A copy of the database alone, without `server.key`, opens
nothing.

**Whoever runs the server can read what you sync.** The server holds the key,
so it can read profiles, cookies and saved passwords. When it is your own
server, that is you. If you sync through a server someone else runs, the app
warns you about this before connecting.

**An invite is a login.** An invite looks like
`http://203.0.113.10:8787#eyJ…`: the server’s address, then a token. Anyone
who has your admin invite can sign in as you and read everything you sync.
Keep it as you would a password: in a password manager, not in a chat or a
shared document.

**Admin invites last a year.** The admin token in an invite is good for 365
days. `octopus-agent-team-server --print-invite` prints a fresh one at any
time, also while the server runs. It does not cancel the old ones: invites
printed before keep working until they expire.

**To cancel every admin invite at once** (for example after one leaked), stop
the server, delete the `admin_secret` row from the `meta` table of
`team.sqlite`, and start it again:

```bash
sqlite3 /path/to/data/team.sqlite "DELETE FROM meta WHERE key = 'admin_secret';"
```

On the next start the server prints a new admin invite, as on its first run.
Every computer connected with an old admin invite then has to connect again
with the new one. This needs the `sqlite3` tool on the machine; the Docker
image has no shell or tools, so stop the container and work on the volume’s
files from the host or another container.

**Back up `team.sqlite` and `server.key` together.** The database cannot be
read without its key. See [Back up and restore the server](#back-up-and-restore-the-server).

---

## Where to run the server

Run it on a machine that stays on and that all your computers can reach:

* **A small VPS.** The simplest choice when your computers are in different
  places. The server is light: one program with its database built in.
* **A home server or a computer that stays on**, such as a NAS, a mini PC or
  a desktop that is never shut down.
* **One of your own computers** only works while that computer is on. Sync
  waits while the server is off, and changes go up when it is back.

### Ports and firewall

The server listens on one TCP port, `8787` by default. Open that port for
inbound TCP in the machine’s firewall and, on a VPS, in the provider’s
firewall or security group.

By default the server listens on `127.0.0.1:8787`, which only the machine
itself can reach. Set `SHARDBROWSER_TEAM_BIND=0.0.0.0:8787` to accept other
computers. The Docker image already does this.

### Behind a router (NAT), a domain or a port forward

The invite the server prints starts with the address it listens on. When your
computers reach it under another address, set `SHARDBROWSER_TEAM_PUBLIC_URL`
to that address, so invites start with it:

* A home server behind a router: forward TCP port 8787 on the router to the
  server, and set `SHARDBROWSER_TEAM_PUBLIC_URL` to your public IP address or
  a dynamic DNS name, for example `http://myhome.example.net:8787`.
* A VPS with a domain: `http://sync.example.com:8787`.
* A VPN such as Tailscale or WireGuard: the server’s address on that network.

The value may leave out `http://`, which is then added. It may not contain
`#` or spaces.

If you leave it unset and the server listens on `0.0.0.0` or `127.0.0.1`,
the printed invite carries that address, with a hint under it:
`replace 0.0.0.0 with this machine's address, or set SHARDBROWSER_TEAM_PUBLIC_URL`.
You can also fix the invite by hand: replace the part before `#`.

### Settings

The variable names still start with `SHARDBROWSER_TEAM_`, kept for
compatibility. The older `SHARDX_TEAM_*` names are also read when the new one
is not set, with a warning in the log.

| Variable | Default | Meaning |
|---|---|---|
| `SHARDBROWSER_TEAM_BIND` | `127.0.0.1:8787` | Address and port to listen on. `0.0.0.0:8787` accepts other computers. |
| `SHARDBROWSER_TEAM_DATA_DIR` | `./data` | Folder with `team.sqlite` and `server.key`. Made if missing. |
| `SHARDBROWSER_TEAM_NAME` | `Team` | The server’s team name, read on the first start only. Up to 64 characters. |
| `SHARDBROWSER_TEAM_TRASH_DAYS` | `30` | Days a deleted team item stays in the team’s Trash. |
| `SHARDBROWSER_TEAM_PUBLIC_URL` | `http://` + bind address | The address invites start with. |
| `RUST_LOG` | `info` | Log level. |

The program takes one flag: `--print-invite` prints a fresh admin invite for
the team in the data folder and exits. Run it with the same
`SHARDBROWSER_TEAM_DATA_DIR` (and `SHARDBROWSER_TEAM_PUBLIC_URL`) as the
server; pointed at a folder with no team in it, it stops with
`no team in …: point SHARDBROWSER_TEAM_DATA_DIR at the server's data directory`.

---

## Run the server with Docker

The image `ghcr.io/harindujayakody/octopus-agent-team-server` is built for
Linux x64 and arm64. `:latest` follows the newest release; each release also
has its own tag, such as `:2.4.0`.

1. Start it. Replace the public address with yours, or leave that line out if
   your computers reach the server at the machine’s own address:

   ```bash
   docker run -d --name octopus-agent-team --restart unless-stopped \
     -p 8787:8787 -v octopus-agent-team:/data \
     -e SHARDBROWSER_TEAM_NAME='My sync' \
     -e SHARDBROWSER_TEAM_PUBLIC_URL='http://203.0.113.10:8787' \
     ghcr.io/harindujayakody/octopus-agent-team-server:latest
   ```

   The image already listens on `0.0.0.0:8787` and keeps its data in `/data`,
   here the named volume `octopus-agent-team`.

2. Read the first-run output:

   ```bash
   docker logs octopus-agent-team
   ```

   It shows the team’s name and id, an `invite:` line and an `admin token:`
   line. This is printed once and never again. Copy the invite somewhere safe.

3. Check that the server answers from another computer:

   ```bash
   curl http://203.0.113.10:8787/health
   ```

   It answers `{"status":"ok","team":"…"}`.

Lost the invite? Print a new one:

```bash
docker exec octopus-agent-team octopus-agent-team-server --print-invite
```

**Bind mount instead of a volume:** the server runs as user `65532` inside
the container. A host folder mounted at `/data` must be writable by that
user, for example `sudo chown 65532:65532 /srv/octopus-agent-team`.

**Docker Compose** (example):

```yaml
services:
  octopus-agent-team:
    image: ghcr.io/harindujayakody/octopus-agent-team-server:latest
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      SHARDBROWSER_TEAM_NAME: "My sync"
      SHARDBROWSER_TEAM_PUBLIC_URL: "http://203.0.113.10:8787"
    volumes:
      - octopus-agent-team:/data
volumes:
  octopus-agent-team:
```

---

## Run the server as a program

Download the server from the
[latest release](https://github.com/harindujayakody/octopus-agent/releases/latest):

| System | File |
|---|---|
| Linux x64 | `octopus-agent-team-server-linux-x64.tar.gz` |
| Linux arm64 | `octopus-agent-team-server-linux-arm64.tar.gz` |
| macOS (Apple silicon) | `octopus-agent-team-server-macos-arm64.tar.gz` |
| Windows x64 | `octopus-agent-team-server.exe` |

The program is not signed. On macOS, remove the quarantine flag once; on
Windows, SmartScreen warns as it does for the app.

### Linux and macOS

```bash
tar -xzf octopus-agent-team-server-linux-x64.tar.gz
chmod +x ./octopus-agent-team-server
# macOS only:
xattr -d com.apple.quarantine ./octopus-agent-team-server

SHARDBROWSER_TEAM_NAME='My sync' \
SHARDBROWSER_TEAM_BIND=0.0.0.0:8787 \
SHARDBROWSER_TEAM_DATA_DIR=./team-data \
SHARDBROWSER_TEAM_PUBLIC_URL='http://203.0.113.10:8787' \
  ./octopus-agent-team-server
```

The first start prints the invite. Stop the server with Ctrl-C; it finishes
the requests under way, then exits.

#### Run it as a systemd service (example)

This is an example for a Linux server with systemd. Adjust the paths, user
and address.

```bash
sudo useradd --system --home /var/lib/octopus-agent-team --create-home octopus-team
sudo install -m 755 ./octopus-agent-team-server /usr/local/bin/
```

`/etc/systemd/system/octopus-agent-team.service`:

```ini
[Unit]
Description=Octopus Agent sync and team server
After=network-online.target
Wants=network-online.target

[Service]
User=octopus-team
Group=octopus-team
Environment=SHARDBROWSER_TEAM_NAME=My sync
Environment=SHARDBROWSER_TEAM_BIND=0.0.0.0:8787
Environment=SHARDBROWSER_TEAM_DATA_DIR=/var/lib/octopus-agent-team/data
Environment=SHARDBROWSER_TEAM_PUBLIC_URL=http://203.0.113.10:8787
ExecStart=/usr/local/bin/octopus-agent-team-server
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now octopus-agent-team
sudo journalctl -u octopus-agent-team    # the first-run invite is here
```

A new invite later, as the service’s user and with its settings:

```bash
sudo -u octopus-team env \
  SHARDBROWSER_TEAM_DATA_DIR=/var/lib/octopus-agent-team/data \
  SHARDBROWSER_TEAM_PUBLIC_URL=http://203.0.113.10:8787 \
  /usr/local/bin/octopus-agent-team-server --print-invite
```

Open the port if the machine runs a firewall, for example
`sudo ufw allow 8787/tcp`.

#### Keep it running on a Mac (example)

On a Mac that stays on, a launchd agent starts the server at login. Save as
`~/Library/LaunchAgents/com.example.octopus-agent-team.plist`, adjust the
paths, then run `launchctl load ~/Library/LaunchAgents/com.example.octopus-agent-team.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.octopus-agent-team</string>
  <key>ProgramArguments</key>
  <array><string>/Users/me/octopus-agent-team/octopus-agent-team-server</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SHARDBROWSER_TEAM_BIND</key><string>0.0.0.0:8787</string>
    <key>SHARDBROWSER_TEAM_DATA_DIR</key><string>/Users/me/octopus-agent-team/data</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/me/octopus-agent-team/server.log</string>
  <key>StandardErrorPath</key><string>/Users/me/octopus-agent-team/server.log</string>
</dict>
</plist>
```

The first-run invite is then in `server.log`.

### Windows

In PowerShell, in the folder with the downloaded program:

```powershell
$env:SHARDBROWSER_TEAM_NAME = "My sync"
$env:SHARDBROWSER_TEAM_BIND = "0.0.0.0:8787"
$env:SHARDBROWSER_TEAM_DATA_DIR = "C:\OctopusAgentTeam\data"
$env:SHARDBROWSER_TEAM_PUBLIC_URL = "http://203.0.113.10:8787"
.\octopus-agent-team-server.exe
```

Allow the port through Windows Firewall (run PowerShell as administrator):

```powershell
New-NetFirewallRule -DisplayName "Octopus Agent sync server" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

#### Start it with Windows (example)

A simple way is a scheduled task that runs a small script at startup. Save
this as `C:\OctopusAgentTeam\start.cmd`, with the program in the same folder:

```bat
@echo off
set SHARDBROWSER_TEAM_BIND=0.0.0.0:8787
set SHARDBROWSER_TEAM_DATA_DIR=C:\OctopusAgentTeam\data
set SHARDBROWSER_TEAM_PUBLIC_URL=http://203.0.113.10:8787
C:\OctopusAgentTeam\octopus-agent-team-server.exe >> C:\OctopusAgentTeam\server.log 2>&1
```

Then, in an administrator PowerShell:

```powershell
schtasks /create /tn "Octopus Agent sync server" /tr "C:\OctopusAgentTeam\start.cmd" /sc onstart /ru SYSTEM
schtasks /run /tn "Octopus Agent sync server"
```

The first-run invite is in `C:\OctopusAgentTeam\server.log`. The server
limits its data folder to the account it runs as, SYSTEM and Administrators,
so run `--print-invite` from an administrator prompt with the same
`SHARDBROWSER_TEAM_DATA_DIR`.

If you prefer a real Windows service, a service wrapper such as
[NSSM](https://nssm.cc/) can run `octopus-agent-team-server.exe` with the same
environment variables.

---

## Connect your first computer

1. Open Octopus Agent and go to **Settings › Sync**.
2. Under **Your own server**, paste the admin invite into
   **Invite or server address**. You can also paste the server’s address
   there and the token into **Access token**.
3. Click **Connect**. When it works, a notice says **Sync is on**.

**Set up a server…** on the same tab opens a short guide with the same steps.

After connecting, the tab shows:

* **Server**: the address, marked as your own server.
* **This computer**: the name your other computers see, with **Rename…**.
  Give each computer a clear name, such as “Office PC” or “MacBook”; it is
  what you see when a profile is open there.
* **Your other computers**, with **Copy invite**.
* **What syncs**, and the sync status (**Synced just now**, **Offline**,
  **Sync stopped**) with **Sync now** or **Retry**.

---

## Add another computer

For example, your first computer is a Windows PC and you add a Mac:

1. Install Octopus Agent on the Mac. Use the same version on every computer
   (see [Troubleshooting](#troubleshooting)).
2. On the Windows PC, open **Settings › Sync** and click **Copy invite**
   under **Your other computers**.
3. Get the invite to the Mac safely, for example through your password
   manager. It is the same login as your admin invite.
4. On the Mac, open **Settings › Sync**, paste it into
   **Invite or server address** and click **Connect**.
5. On the Mac, under **This computer**, click **Rename…** and give it a name.

The Mac then downloads your synced profiles, proxies and the rest. A profile’s
session comes down the first time you start it there.

It works the same the other way round, and for Linux.

---

## Choose what syncs

The **What syncs** switches apply on all your computers:

| Switch | On | Off |
|---|---|---|
| **All profiles** | Every profile syncs, with cookies, site data and saved passwords. | Only the profiles you pick. |
| **All proxies** | Every proxy. | Only the proxies assigned to synced profiles. |
| **Folders and tags** | With their colors. | Not synced. |
| **Bookmarks** | Synced. | Not synced. |
| **Extensions** | With their files. | Not synced. |
| **Automation projects** | Synced; secret step values never leave the computer. | Not synced. |

With **All profiles** off, pick profiles from their menu with
**Sync this profile** (or **Sync these profiles** for a selection), and stop
one with **Stop syncing**. A synced profile shows “Synced to your computers”.

Turning a switch off stops syncing that kind; what is already on your
computers stays.

### Disconnect

**Disconnect…** under **Server** asks what happens to your copy on the
server:

* **Keep it on the server**: connect again later, here or on another
  computer, and pick up where you left off.
* **Remove it from the server**: your synced data is deleted from the server
  for good, and your other computers stop syncing.

Either way, the copies on your computers stay.

---

## Use a profile on two computers safely

### One computer at a time

A synced profile can be open on only one computer at a time. If you start it
on the Mac while it is open on the PC, the app refuses with
“It’s open on Office PC. Only one computer can have it open at a time.”, and
the profile’s row shows **On Office PC** with the time that computer was last
seen.

This is on purpose. Two browsers running the same profile would each write
their own cookies and sessions, and whichever closed last would overwrite the
other’s logins. Sites would also see the same fingerprint and cookies from two
places at once. So close the profile on one computer, wait until it is saved
(the row shows that it is saving), then start it on the other.

How it works: starting a synced profile takes a lease on the server. The
computer renews it every 30 seconds while the browser is open. When the
browser closes, the session is sent up and the lease is given back, and the
next computer to start the profile gets that session.

### When a computer crashed or went offline with a profile open

* **The app crashed, the computer did not.** Each open synced profile has a
  small guard process. If the app dies, the guard closes the browser, sends
  the session up and cleans up.
* **The computer crashed, lost power or lost its connection.** Nobody renews
  the lease any more, and the server frees it about 90 seconds after the last
  renewal. The profile can then start on another computer, with the last
  session that reached the server. Changes made in the crashed session were
  only on that computer.
* **You can’t wait, or that computer is off.** Choose **Open here instead**
  from the profile’s menu or from the notice shown when the start is refused.
  The other computer closes the profile at its next sync, and changes made
  there and not yet synced are kept as a conflict copy.

When the crashed computer’s app starts again, it closes what was left open and
sends that session up if nobody has saved the profile since. If the profile
was used elsewhere in the meantime, the newer session on the server is not
overwritten.

If the server itself restarts, profiles that were open keep their leases for
another 90 seconds, so the computers that have them open can renew them.

### Working offline

If the server does not answer, you can still start your synced profiles; their
sessions go up when the server is back, and the status shows how many changes
are waiting (for example “Offline, 3 changes waiting”). While offline, the app
can’t take the lease, so it can’t stop you from opening the same profile on
another computer. Avoid that: it is the way to get a conflict copy.

### Conflict copies

When the same profile changed on two computers before either synced, both
versions are kept. The server’s version keeps the profile’s place, and this
computer’s version becomes a new profile named “Name (conflict copy)”. The app
says so: “A profile changed on two computers: your changes from here are in
“Name (conflict copy)”.”

Pick the one you want and delete the other. Don’t run both: they share one
fingerprint and the same cookies.

---

## Windows, macOS and Linux together

**A profile made on Windows runs on a Mac, and the other way round.** Browsers
encrypt cookies and saved passwords with a key that belongs to the computer,
so the raw files from one computer can’t be read on another. Octopus Agent
therefore also packs cookies and saved passwords in a portable form. On the
receiving computer:

* from another operating system, or on any Windows computer, the cookie store
  is rebuilt from the portable copy and the saved passwords are sealed again
  with that computer’s key;
* between two Macs or two Linux computers, the cookie store is used as it is.

Either way you stay signed in. The profile keeps the fingerprint it was made
with, so a profile with a Windows fingerprint still presents as Windows when
it runs on a Mac.

**The browser has to be on each computer.** Profiles using the Octopus Agent
engine need the engine installed there, as on any computer. A profile set to
stock Google Chrome, Chromium, Firefox, Brave, Thorium or Helium starts only
if that browser is installed in Octopus Agent on that computer, in
**Settings › Browsers**. Otherwise the start stops with “Google Chrome is not
installed in Octopus Agent. Install it from Settings > Browsers, then start
the profile again.”

**Stock browser profiles: settings travel, sessions do not (yet).** The
session packer collects the Octopus Agent engine’s browser data. A profile
set to a stock browser keeps its browser data in a separate folder that is not
packed, so its settings, proxy and the one-computer-at-a-time lock sync, but
its cookies and logins stay on the computer where you used it. Use the
Octopus Agent engine for profiles you want signed in everywhere, or move a
stock browser profile with a profile backup (same operating system).

---

## Update the server

Keep the server and the apps on the same release. A server newer than an app
asks you to update the app; an app newer than the server can’t talk to it
until the server is updated.

**Docker:**

```bash
docker pull ghcr.io/harindujayakody/octopus-agent-team-server:latest
docker stop octopus-agent-team && docker rm octopus-agent-team
# then the same docker run command as before
```

The data stays in the `octopus-agent-team` volume. With Compose:
`docker compose pull && docker compose up -d`.

**Program:** stop the server (Ctrl-C, `systemctl stop`, or end the task),
replace the program with the new release, and start it again. The data folder
is not touched.

Stopping the server is safe: it finishes the requests under way first, and
open profiles keep their leases for 90 seconds after it starts again.

---

## Back up and restore the server

The whole server is its data folder: `team.sqlite` (with `team.sqlite-wal`
and `team.sqlite-shm` while it runs) and `server.key`. Back up the folder, and
always keep `team.sqlite` and `server.key` together. Treat the backup as
secret: with both files, anyone can read everything on the server.

**Program:** stop the server, copy the data folder, start it again:

```bash
sudo systemctl stop octopus-agent-team
sudo tar -czf octopus-agent-team-backup.tgz -C /var/lib/octopus-agent-team data
sudo systemctl start octopus-agent-team
```

**Docker volume:**

```bash
docker stop octopus-agent-team
docker run --rm -v octopus-agent-team:/data -v "$PWD":/backup alpine \
  tar -czf /backup/octopus-agent-team-backup.tgz -C /data .
docker start octopus-agent-team
```

### Restore

Stop the server, put the backed-up files back in the data folder (Docker:
extract into the volume the same way, with `tar -xzf`), and start it. Keep the
files owned by the account the server runs as (`65532` in Docker).

Restored on a machine with a **new address**, start the server with the new
`SHARDBROWSER_TEAM_PUBLIC_URL`, print an invite with `--print-invite`, and on
each computer choose **Disconnect…** with **Keep it on the server**, then
connect with the new invite. The server’s key is the same, so your computers
still recognise it.

If `server.key` is lost, the database can’t be read. You have to start a new
server; the app then reports that the server “shows another key”, and each
computer connects again with the new invite. The copies on your computers are
not lost.

---

## Troubleshooting

| What you see | What it means and what to do |
|---|---|
| “The sync server didn’t answer: check that it is running and the address is right.” | The app can’t reach the server. Check it runs (`docker logs octopus-agent-team`, `systemctl status`), that `SHARDBROWSER_TEAM_BIND` is `0.0.0.0:8787` and not `127.0.0.1`, that the port is open in every firewall, and that `curl http://<address>:8787/health` works from the computer. |
| The invite starts with `http://0.0.0.0:8787` or `http://127.0.0.1:8787` | That is the address the server listens on, not one other computers can use. Replace the part before `#` with the real address, or set `SHARDBROWSER_TEAM_PUBLIC_URL` and print a new invite with `--print-invite`. |
| Works at home, not elsewhere | The invite carries a local address (such as `192.168.1.20`). Forward the port on the router and use your public address or a dynamic DNS name in `SHARDBROWSER_TEAM_PUBLIC_URL`. |
| “That address answers, but not as an Octopus Agent team server.” or “… does not answer as an encrypted team server: it is not one, or it is older than this launcher” | The address points at something else, or the server is older than the app. Check the port, and update the server. |
| “… is a newer team server than this launcher: update Octopus Agent” | Update the app on this computer. |
| “this session was saved by a newer launcher: update this one to open it” | Another computer runs a newer app. Update this one. |
| “… is not this team’s server: it shows another key. If the server was set up anew, paste a new invite” | The server was set up again (new data folder or lost `server.key`), or the address now leads to a different server. Disconnect and connect with the new server’s invite. |
| “The server does not know this token: check it, or ask whoever runs the server for a new invite.” or “The server no longer knows this token. If you reset the server or its data folder, connect again with its new admin token.” | The invite is wrong, expired, or its admin secret was reset. Print a new invite with `--print-invite` and connect with it. |
| `no team in …: point SHARDBROWSER_TEAM_DATA_DIR at the server's data directory` | `--print-invite` ran against the wrong folder. Give it the server’s `SHARDBROWSER_TEAM_DATA_DIR`. |
| “It’s open on … Only one computer can have it open at a time.” | Close the profile there and wait until it is saved. If that computer is off or crashed, wait about 90 seconds, or use **Open here instead**. |
| A profile named “… (conflict copy)” appeared | The profile changed on two computers. Keep the version you want and delete the other. |
| `the session is … MB, more than the 252 MB the server keeps` | The profile’s session is too big even after leaving out site storage. Clear large site data in the profile, then close it again. |
| “Google Chrome is not installed in Octopus Agent. Install it from Settings > Browsers, then start the profile again.” | The profile uses a stock browser that is not installed on this computer. Install it in **Settings › Browsers**. |
| “None of the synced profiles is on this computer any more, so nothing was deleted from the server. Check that the data folder is where it was.” | Octopus Agent’s data folder moved or was emptied. Sync stopped instead of deleting your profiles from the server. Put the folder back, or disconnect and connect again. |
| “Your synced data was removed from this server, from another of your computers.” | Another computer disconnected with **Remove it from the server**. Disconnect here; this computer keeps its copies. |
| Docker: the container exits right after starting | With a bind mount, the host folder must be writable by user `65532`. Check `docker logs`. |

# Roadmap

What has shipped in Octopus Agent, what is being built now, and ideas for
later. The “Next” and “Later” lists are ideas, not promises: they may change,
move or be dropped.

## Shipped

### 2.6.0

* **Check for updates in What’s new.** Check, and install a new version after closing open profiles safely.
* **Disk usage.** Settings › Storage shows what Octopus Agent takes, by kind, and Clear all caches empties every closed profile’s cache.
* **A 2 GB cache limit.** A profile’s cache is emptied by itself before it starts past 2 GB; the editor shows it as a bar with the last cleared date.
* **Bookmark sets.** Group bookmarks into sets and pick the sets each profile gets; import from any browser’s HTML export.
* **Usage in Peek.** Disk, cache and cache limit under Activity.
* **Signed macOS app.** No more “damaged” on Apple Silicon; Open Anyway on first launch.

### 2.5.0

* **Extensions in every profile.** An extension added to the library loads into every profile and is pinned on its toolbar; nothing is picked per profile. Chrome extensions go to every Chromium browser, Google Chrome included.
* **Firefox add-ons library.** Add a Firefox add-on from its addons.mozilla.org link and every Firefox profile gets it, pinned.
* **Authenticator page in the sidebar.** TOTP codes for your accounts. Saved accounts are encrypted on this computer, and a quick paste shows a code without saving anything.
* **Custom start page.** Set the page a profile opens with, per profile, with a global default for the rest.
* **Clearer “open on another device” warning.** Says plainly when a synced profile is open on another computer, and what to do.
* **Browser picker on the Basics tab.** Choose a new profile’s browser on the Basics tab, beside Name, as well as on the Fingerprint tab.
* **Start always shown.** Each row’s Start button shows all the time, not only on hover.
* **Sync server guide.** [Set up cloud sync](docs/SYNC-SERVER.md): running the sync server and connecting several computers.

### 2.4.0

* **Google Chrome Stable.** The Google Chrome option installs official Chrome Stable instead of Chrome for Testing.
* **Brave, Thorium and Helium.** Three more Chromium browsers to install from Settings › Browsers and pick for a profile.
* **Back up and restore a profile.** A profile with all its browser data, cookies and logins included, in one file.
* **Extensions installed in profiles.** Extensions a profile installed inside its browser show on the Extensions page.
* **Chromium and Firefox extensions apart.** Extensions are marked by kind, and Firefox profiles no longer offer Chrome extensions.
* **One-click ad blocker.** Add extension › Add ad blocker puts uBlock Origin Lite in the library.

### 2.3.0

* **Profile icons.** Give a profile the icon of the site it is for and find it in the list at a glance.
* **Browser column.** The list can show which browser each profile starts in, with its logo.
* **Clear a profile’s cache.** See a profile’s cache size and empty it; cookies, logins and history stay.
* **Your own tag colors.** A tag can take any hex color, not only the eight in the palette.
* **Profile names on windows.** Browser windows carry the profile’s name for the taskbar and Alt-Tab.
* **Only browsers installed here.** Profiles start only browsers installed in Octopus Agent, never the copy on the computer.

### 2.2.0

* **Octopus Agent.** New name and logo, its own data folder, built on ShardBrowser 2.1.2.
* **Automatic updates.** New releases install from inside the app, with the signature checked first.
* **Browsers page.** Google Chrome, Chromium and Firefox install from Settings › Browsers.
* **A profile keeps its browser.** The browser is chosen when a profile is made and stays fixed.
* **No proxy store, no upsells.** The store, its trial popup and the usage statistics are gone.

Earlier history: ShardBrowser 2.1.2 and before, see What’s New in the app.

## Next

Ideas we would like to do soon. Not promises.

* **Extension updates for Firefox add-ons.** Check addons.mozilla.org for new versions of the library’s add-ons, as the Web Store is checked for Chrome extensions.
* **QR-code import for the authenticator.** Add an account by reading the QR code a site shows, or an exported QR image.
* **Per-profile 2FA in Peek.** Link an authenticator account to a profile and show its current code in Peek.
* **Stock browser sessions in sync.** Carry cookies and logins of profiles that use stock Chrome, Chromium or Firefox, not only the Octopus Agent engine’s.

## Later

Larger ideas. Not promises.

* **Ad and tracker blocking for every browser.** Built-in blocking based on adblock-rust, working the same for the Octopus Agent engine and the stock browsers.
* **Profile backups portable across systems.** Carry cookies and saved passwords in the portable form sync uses, and seal them again on restore, so a backup made on Windows restores signed in on a Mac.
* **Scheduled automation improvements.** More scheduling options, clearer run history and retries for automation projects.
* **More languages.** More translations of the app.

## Request a feature

Open an issue on [GitHub](https://github.com/harindujayakody/octopus-agent/issues)
with what you want to do and why. Bug reports with steps to reproduce help
the most.

If Octopus Agent helps you, please [star the repo](https://github.com/harindujayakody/octopus-agent).
It is the easiest way to support the project.

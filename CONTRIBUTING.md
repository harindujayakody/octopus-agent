# Contributing to Octopus Agent

Thanks for helping. Bug reports, fixes and translations are all welcome.

## Report a bug or ask for a feature

Open an [issue](https://github.com/harindujayakody/octopus-agent/issues/new/choose)
and pick a template. For a bug, say which version (*Settings › About*), which
engine (the profile's browser: Octopus Agent engine, Chrome, Chromium or
Firefox) and which OS, and how to make it happen.

**Security problems:** do not open an issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22, Rust (stable) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

The UI also runs without the Rust side, against a mock backend:

```bash
VITE_MOCK=1 npx vite
```

## Before you open a pull request

```bash
npm run check                       # types, lint, copy and design rules, unit tests
npm run test:e2e -- --project=dev   # Playwright, against the mock backend
cd src-tauri && cargo test          # Rust
```

CI runs `npm run check`, a dependency audit (`npm audit`, `cargo audit`) and,
for tags, the release build.

## Guidelines

* Keep a pull request to one change, and describe how you tested it.
* Match the code around you: its naming, comment style and structure.
* Text in the UI goes through `t("key")` with the key in all locale files
  (`src/shared/i18n/locales/`); `npm run check:i18n` checks it.
* Use the UI kit (`ui-kit/`) and its tokens; `npm run check` flags raw sizes,
  colors and radii.
* Never commit secrets: signing keys, tokens, `team-server/data/`.

By contributing you agree that your contribution is licensed under the
project's [license](LICENSE).

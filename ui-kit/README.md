# Octopus Agent UI Kit

A React + **Tailwind CSS v4** component library used by the Octopus Agent
launcher. The copy in the launcher repo is canonical (ADR 0001). Every component is **light / dark theme aware** and lives in its own
folder. The design tokens live in code, in
[`src/styles/tokens.css`](./src/styles/tokens.css): that file is the source of
truth, not a design file.

## Tech stack

- [React 19](https://react.dev/) + [Vite](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) via `@tailwindcss/vite`
- TypeScript, ESLint
- [Hugeicons](https://hugeicons.com/) (`@hugeicons/react`, the free set) for
  the icons kit components draw; React is a peer dependency

## Getting started

```bash
npm install
npm run dev      # the showcase (src/App.tsx, styled by src/styles/globals.css) at http://localhost:5173
npm run build    # type-check + production build
npm run preview
npm run lint
```

## Project structure

```
src/
├─ icons/                 # the Remix icon set, kept for the dashboard (see below)
├─ components/            # one folder per component
│  ├─ Button/  IconButton/  Badge/  Tag/  Chip/  Alert/  Card/  EmptyState/
│  ├─ Input/  Textarea/  Label/  Select/  Checkbox/  Radio/  Switch/  Slider/
│  ├─ Tabs/  SegmentControl/  Breadcrumb/  Pagination/  NavItem/  ProgressBar/
│  ├─ Menu/  Popover/  Tooltip/  Modal/  DialogModal/  AlertModal/  CountryImage/
│  └─ index.ts           # barrel export
├─ theme/                # ThemeProvider, useTheme, ThemeToggle
├─ styles/tokens.css     # the design tokens: the source of truth
├─ styles/globals.css    # the showcase's stylesheet: full Tailwind (Preflight) + tokens.css
├─ styles/lib.css        # builds dist/styles.css: tokens + utilities, no Preflight
├─ lib/                  # cn(), Hugeicons wrapper (icons.tsx), overlays, virtual list
├─ demo/                 # showcase-only helpers
├─ App.tsx               # living component gallery
└─ index.ts              # public package entry
scripts/                 # colors.source.mjs + gen-colors.mjs (colors), color-math.mjs, css-tokens.mjs
```

## Components

| Category | Components |
| --- | --- |
| Actions | `Button` (primary/neutral/error × filled/stroke/lighter/ghost), `IconButton` |
| Status | `Badge`, `Tag`, `Chip`, `Alert`, `ProgressBar`, `EmptyState` |
| Forms | `Input`, `Textarea`, `Label`, `Select`, `Checkbox`, `Radio`, `Switch`, `Slider` |
| Navigation | `Tabs`, `SegmentControl`, `Breadcrumb`, `Pagination`, `NavItem` |
| Overlays | `Menu`, `Popover`, `Tooltip`, `Modal`, `DialogModal`, `AlertModal` |
| Layout | `Card`, `CountryImage` |

```tsx
import { Button, Badge, Input, ThemeProvider } from '@/components'

<Button variant="primary" mode="filled">Save</Button>
<Badge color="success" variant="light" dot>Active</Badge>
<Input label="Email" placeholder="you@example.com" />
```

## Breaking changes in 0.2.0

A host that mirrors the kit changes these on the same day it takes the new
copy:

- **`EmptyState`:** the `tile` prop is removed. A first run's way in is `action`
  (`{ label, icon?, onClick }`, a filled primary button) and a quieter second one
  is `secondary` (`{ label, onClick }`, a stroke button); `actions` stays for any
  other controls.
- **`Toast`:** the `count` prop is removed. A repeat keeps one toast and
  restarts its time; nothing counts repeats.
- **`Menu`:** at most 320 px wide (it grew with its widest item). A heading wider
  than that is cut at the end, or with `headingTruncate="middle"` (and
  `menuHeadingTruncate="middle"` on `DataList`) in the middle, which keeps the
  last characters of an address or a path visible.
- **Popovers:** `Menu`, `Popover`, `Select` and `Combobox` lists sit on
  `bg-bg-popover` instead of `bg-bg-raised`, and `--shadow-float` is stronger in
  dark. A host with its own popover surface moves it to `bg-bg-popover` too, or
  it reads darker than the kit's.
- **New tokens:** `--bg-popover`; the row fills (`--row-fill`, set by
  `row-fill-active`, `row-fill-selected` and `row-fill-selected-active`, from
  `--bg-row-hover`, `--bg-row-active`, `--bg-row-selected` and
  `--bg-row-selected-hover`, each with a `-tile` twin for rows on a tile);
  `--primary-text-on-highlight`, `--error-text-on-highlight`,
  `--warning-text-on-highlight`, `--success-text-on-highlight` and
  `--information-text-on-highlight` (state text on a highlighted or pressed
  row); `--error-tint-menu` (the danger menu item when aimed at). The
  launcher's `--label-chip-text-highlight` (a label chip on a highlighted
  popover row) lives in its app styles, not in the kit; a host that draws
  label chips in menus defines its own.
- **`OptionList`:** rows without an icon keep an empty 14 px icon slot when any
  row shown has one, so labels line up (`reserveIcon` sets it for every row).
  New and additive: `DataList` `minCardWidth` (grid variant).

## Changes in 0.2.2

- DialogModal: the confirm button is described by `footerNote` (`aria-describedby`).
- Tabs: a `badge` reads with a space before it.
- ThemeProvider: choosing a theme ends any preview.

## Changes in 0.2.1

Additive; a host that mirrors the kit takes it with no change of its own:

- **New tokens:** `--layer-tour` (65, between toasts and the window's own
  controls) and `--tour-scrim` (50% black in both themes), for a guided tour
  drawn over the page.
- **`ThemeProvider`:** reading and writing the stored theme no longer throws
  when storage is blocked (a private window, a policy); it follows the system
  theme and keeps the choice until the page is reloaded.

## Design tokens

`src/styles/tokens.css` is the only source. Tokens name **roles**, never
shades: pick the role that says what a thing is, never a token because its
value happens to match ("never borrow by value").

- **Layers:** `bg-bg-canvas` (app shell, sidebar), `bg-bg-surface` / `bg-bg-white-0`
  (cards, lists, fields), `bg-bg-raised` (dialogs, toasts, bulk bars),
  `bg-bg-popover` (menus, popovers, Select and Combobox lists: white in light, a
  step lighter than the list tile in dark, so it stands out without a border),
  `bg-bg-sunken` (tracks). In dark they step lighter as they rise.
- **Overlays** (translucent, work on any layer): `bg-bg-weak-50` (chips, key caps,
  wells, disabled), `bg-bg-hover`, `bg-bg-active` (keyboard highlight, pressed,
  current item), `bg-bg-selected` (checked rows).
- **Text:** `text-text-strong-950`, `-sub-600`, `-soft-400` (supplementary
  metadata only), `-disabled-300`. Icons: `text-icon-*`.
- **Strokes:** `stroke-soft-200` (hairline), `stroke-sub-300`, `stroke-control`
  (checkbox, radio and switch edges, 3:1), `stroke-image` (flags, icons).
- **Brand:** `bg-primary-base` is a fill only; text uses `text-primary-text`,
  tints `bg-primary-tint(-hover)`; focus draws in `--focus`.
- **States** (error, warning, success, information): `-base` for dots, icons and
  rings (3:1), `-text` for words (4.5:1), `-tint` / `-tint-hover` for fills;
  `bg-error-fill` for a danger button. A state is never color alone: a word or
  a distinct icon goes with it. `-weak`, `-soft` and `-alpha-16` are aliases.
- **Type roles:** `text-page-title`, `-panel-title`, `-section-title`, `-overline`
  (sidebar group names and Peek section titles only), `-ui`, `-body`,
  `-field-label` (or the `Label` component), `-secondary`, `-help`, `-micro`,
  `-mono`, and `-stat` (26/32) and `-stat-sm` (20/26) for the key number of
  a card, a tile or Peek's stat strip (semibold, tabular, strong; its unit
  beside it in `-body` soft); `measure` for reading width. One role per element.
- **Geometry:** a 4 px grid in px; radii `rounded-control` 8, `-surface` 12,
  `-dialog` 16, `-chip` 6, `-chip-sm` 4 (a container's radius is its item's plus
  its padding); insets `p-inset` 16, `px-gutter` 24 (21 in the launcher),
  `px-cell` 12, `gap-stack-*`.
- **Motion:** one curve (`ease-out`, `cubic-bezier(0.23, 1, 0.32, 1)`),
  `--motion-exit-fast/fast/base/slow` (75, 100, 150, 200 ms), px travel
  (`--motion-shift`, `--motion-nudge`), `--motion-scale-in`, `--motion-press`.
  Name what moves (`transition-hover`, `transition-[opacity,scale]`), never
  `transition` or `transition-all`. Under reduced motion (the OS, or
  `data-reduce-motion="true"` on `<html>`) nothing travels, scales or blurs:
  entries still fade, overlay exits are instant (`usePresence`), spinners keep
  turning, pending dots keep an opacity pulse; other loops stop with
  `reduced:animate-none`.
- **Live motion:** `--ease-spring` (a critically damped spring, response
  0.3 s, as `linear()` over `--motion-spring`) for whatever moves position;
  `animateFrom(el, to)` runs it from the element's current look, and
  `CountRoll` rolls a count (`--motion-count`) on a short tape: a change
  mid-roll leaves every number on screen where it is and rolls on from
  there. Utilities:
  `halo` (the Running dot's ring) with `animate-halo-once` or `animate-breathe`,
  `row-flash`, `slide-in`, `hover-lift`. `hover-lift` carries its own
  transition (the fills, the lift and the shadow): it replaces
  `transition-hover` or any `transition-*` on the same element, never joins
  one, or the later `transition-property` wins and the lift snaps. Reduce
  motion stops them all at once; the color fades stay. `row-flash` and
  `slide-in` draw their tint as a layer over the element (its `::before`,
  so the element must be positioned and must not use its own `::before`)
  that animates only `opacity`, on the compositor; a list whose cells stack
  lifts the layer over them. The halo's sizes are the `--halo-*` tokens.
- **Material:** `material-bar` (a translucent, blurred surface for a sticky
  header) with `scroll-edge` (a 6 px fade under it while the header carries
  `data-scrolled`). Reduce transparency: solid, with a 1 px divider; forced
  colors: Canvas and a system divider. The divider is a line over the
  header's bottom edge (its `::after`) that takes no layout; the header must
  be positioned (sticky or relative).
- **Focus:** `focus-ring`, `focus-ring-inset` (inside a scroll box),
  `focus-ring-within` (a field's frame): a 2 px outline, 3 px under
  `prefers-contrast: more`; `outline-hidden`, never `outline-none`.
- **Windows contrast themes:** `forced-edge`, `forced-selected`,
  `forced-content` (swatches, dots), `forced-native`, `forced-hidden`.

**Changing a color.** Edit its L, C or H in `scripts/colors.source.mjs`, run
`node scripts/gen-colors.mjs --write` (from `ui-kit/`, or
`node ui-kit/scripts/gen-colors.mjs --write` from the launcher), then the
launcher's `npm run check:contrast` measures every text level on every layer
in both themes and both contrast modes. Hex stays in `tokens.css` with the
OKLCH in a comment; `npm run check:colors` fails if the two disagree.

**Theming another app.** Override `--color-primary-base` after importing
`tokens.css`, and per theme: `--primary-text` (same chroma and hue as the
primary, L 0.507 light and L 0.76 dark, chroma clamped to sRGB),
`--primary-tint` and `--bg-selected` (the primary at 12% light, 22% dark),
`--primary-tint-hover` (18%, 30%) and `--focus` (the primary in light, the
primary text in dark).

### Rules the components keep

- **Spacing in px, never as a step.** Kit components write padding, margin,
  gap and inset as px (`px-[8px]`, `gap-[7px]`), not `px-2`: the launcher maps
  its numeric steps to its pre-grid 3.5 px scale (its `src/app/styles/index.css`),
  so a step would draw differently there and here. The launcher's
  `check:classes` fails on a step in a kit component. Sizes (`h-*`, `size-*`)
  and the named insets above are px everywhere.
- **Density.** Controls hold whole-pixel heights: `xsmall` 30, `small` 34
  (Button, IconButton, Input, the Select trigger, SegmentControl); Checkbox and
  Radio 17 with a 12 tick; Switch 17 x 28 with a 13 knob; Tag 21. Nothing is
  larger than it was before the 4 px grid.
- **Icons** draw at 14 px in a 14 px slot (`size-3.5`), at one stroke,
  `ICON_STROKE`.
- **Small targets** draw small and hit at 24: the DialogModal close button draws
  at 21 with an invisible 24 px hit area (a `::before` 1.5 px out each side); the
  launcher's colour swatches do the same.
- **Label** names one control through `htmlFor` (`as="label"`, the default);
  `as="span"` or `as="div"` names a group through `aria-labelledby`, where
  `htmlFor` is a type error.
- **Menu** checkbox and radio items draw their check at the end of the row,
  after the label and any hint; there is no leading check slot.
- **Overlays close through `usePresence`:** an overlay stays mounted through its
  exit fade (Menu and Tooltip 75 ms, Popover 100, dialogs 150; instant under
  reduced motion) and reads `data-state="closed"` in the same render that `open` goes
  false, so `data-[state=closed]:pointer-events-none` lets the next click
  through at once. A chosen Menu item closes the menu without the fade.

### Migrating from the old type classes (the dashboard)

The AlignUI type classes are gone; map each use by hand:

| Old | Role |
| --- | --- |
| `text-title-h1` to `-h4`, `text-label-xl`, `text-label-lg` | `text-page-title` |
| `text-title-h5`, `-h6`, `text-label-md` | `text-panel-title` |
| `text-label-sm` | `text-ui` |
| `text-label-xs` | `text-secondary font-medium` |
| `text-paragraph-sm`, `-md`, `-lg` | `text-body` |
| `text-paragraph-xs` | `text-secondary` |
| `text-subheading-*` | `text-overline` (sidebar group names and Peek section titles only; elsewhere `text-secondary font-medium` in sentence case) |
| a field label | the `Label` component (`text-field-label`) |

## Icons

The `icons` entry is a small **Remix Icon** set (the 33 glyphs in `src/icons/svg/`),
imported as React components via [SVGR](https://react-svgr.com/)
(`vite-plugin-svgr`). Each keeps `fill="currentColor"`, so **colour follows the
theme** (and any `text-*` utility) automatically.

Kit components draw **Hugeicons** through `src/lib/icons.tsx` at one stroke, `ICON_STROKE` (1.8), which the launcher's own icons use too. The Remix set below stays exported for the dashboard.

```tsx
import { RiSearchLine, RiShieldCheckLine } from '@/icons'

<RiSearchLine className="size-3.5 text-text-sub-600" />   // adapts to theme
<RiShieldCheckLine className="size-3.5 text-primary-text" />

// or import any SVG file directly:
import Home from '@/icons/svg/home-5-line.svg?react'
<Home className="size-3.5" />
```

Names follow Remix in PascalCase with an `Ri` prefix (`close-line` → `RiCloseLine`).
Icons are side-effect-free, so unused ones are tree-shaken from your bundle.
See [src/icons/README.md](./src/icons/README.md) and the icon
[LICENSE](./src/icons/LICENSE).

## Theming

```tsx
import { ThemeProvider, useTheme, ThemeToggle } from '@/theme/ThemeProvider'

<ThemeProvider>
  <App />
</ThemeProvider>
```

`ThemeProvider` toggles `data-theme="light" | "dark"` on `<html>`, supports a
`system` option, persists to `localStorage`, and follows the OS preference on
first load. Drop in `<ThemeToggle />` for a ready-made switch.

## Building the library

```bash
npm run build:lib
```

Emits a consumable package to `dist/`:

- `dist/index.js` + `dist/index.d.ts` — components, `ThemeProvider`, `cn`
- `dist/icons/index.js` + `dist/icons/index.d.ts` — all icons
- `dist/styles.css` — compiled tokens + utilities (import once)
- per-component and per-icon modules → **tree-shakeable**; React stays a peer dep

## Publishing to GitHub Packages (private)

1. Replace `your-github-username` with your GitHub login/org in **`package.json`**
   (`name`, `repository.url`) and **`.npmrc`**:

   ```bash
   sed -i '' 's/your-github-username/YOUR_LOGIN/g' package.json .npmrc
   ```

2. Authenticate npm to GitHub Packages. Create a GitHub **Personal Access Token
   (classic)** with `write:packages` + `read:packages`, then add to your user
   `~/.npmrc` (do **not** commit this):

   ```
   //npm.pkg.github.com/:_authToken=YOUR_TOKEN
   ```

3. Publish (the `prepack` hook builds the library automatically):

   ```bash
   npm publish
   ```

## Consuming it in another project

1. Add an `.npmrc` in that project so the scope resolves to GitHub Packages, and
   authenticate with a token that has `read:packages`:

   ```
   @YOUR_LOGIN:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_READ_TOKEN
   ```

2. Install:

   ```bash
   npm install @YOUR_LOGIN/shardx-ui-kit
   ```

3. Wire up styles. **Pick the mode that matches the host project** — this matters:

### Mode A — host does NOT use Tailwind

Import the standalone, pre-compiled stylesheet once (no Tailwind, no SVGR needed):

```tsx
import '@YOUR_LOGIN/shardx-ui-kit/styles.css'
```

### Mode B — host ALSO uses Tailwind v4 (recommended for such hosts)

> ⚠️ Do **NOT** import `styles.css` here. It ships its own Tailwind layer and
> would collide with the host's Tailwind — breaking responsive/`lg:` precedence
> and layout. Instead, import only the **tokens** and let the host's single
> Tailwind generate the kit's utilities:

In the host's main Tailwind CSS file:

```css
@import "tailwindcss";
@import "@YOUR_LOGIN/shardx-ui-kit/tokens.css";
/* let Tailwind scan the kit's compiled classes (adjust the relative path
   so it points at node_modules from this CSS file): */
@source "../node_modules/@YOUR_LOGIN/shardx-ui-kit/dist";
```

Then use components normally:

```tsx
import { Button, ThemeProvider } from '@YOUR_LOGIN/shardx-ui-kit'
import { RiSearchLine } from '@YOUR_LOGIN/shardx-ui-kit/icons'

<ThemeProvider>
  <Button leftIcon={<RiSearchLine className="size-3.5" />}>Search</Button>
</ThemeProvider>
```

Overlays like `Modal` render into `#portal-root`; add `<div id="portal-root" />`
to the host `index.html`, or the kit falls back to `document.body`.

## Links & client-side navigation (Next.js, React Router…)

Kit components that render links (`Tabs`, `Breadcrumb`) use a native `<a>` by
default. To get framework routing benefits — Next.js prefetch, client-side
navigation and the router cache — inject your framework's link component once
via `LinkProvider`; every kit link then renders through it.

**Next.js (App Router)** — create a client provider and wrap your app:

```tsx
// app/providers.tsx
'use client'
import NextLink from 'next/link'
import { LinkProvider, ThemeProvider } from '@YOUR_LOGIN/shardx-ui-kit'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LinkProvider component={NextLink}>
      <ThemeProvider>{children}</ThemeProvider>
    </LinkProvider>
  )
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers'

export default function RootLayout({ children }) {
  return (
    <html>
      <body><Providers>{children}</Providers></body>
    </html>
  )
}
```

**React Router**: `<LinkProvider component={RouterLink}>` (wrap its `to`/`href`
if needed). **No provider** → components fall back to `<a>` and just work.

## License

Kit: [MIT](./LICENSE). Icons: Remix Icon license — see
[src/icons/LICENSE](./src/icons/LICENSE).

## Credits

Inspired by [ShardBrowser](https://github.com/ProxyShard/ShardBrowser) — thanks
to its authors for the original MIT-licensed kit. The package keeps its
`shardx-ui-kit` name for now.

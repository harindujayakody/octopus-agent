# Icons

SVG icons imported as React components via [SVGR](https://react-svgr.com/)
(`vite-plugin-svgr`). Every icon keeps `fill="currentColor"`, so its colour
follows the surrounding text colour — and therefore the active light/dark theme.

Source: a small **Remix Icon** set (33 glyphs), vendored under [`svg/`](./svg)
and kept for the dashboard. Kit components draw Hugeicons instead, through
`src/lib/icons.tsx`. See [LICENSE](./LICENSE).

## Usage

Named component (recommended):

```tsx
import { RiSearchLine, RiArrowRightSLine } from '@/icons'

<RiSearchLine className="size-3.5 text-text-sub-600" />
<RiArrowRightSLine className="size-3.5" />   // inherits currentColor
```

Direct file import (any icon in `svg/`):

```tsx
import SearchLine from '@/icons/svg/search-line.svg?react'

<SearchLine className="size-3.5" />
```

Icons default to `1em` so `className` sizing (`size-3.5`, the 14 px slot every
UI icon uses) and text `color` control size and colour. Names follow the Remix
convention in PascalCase with an `Ri` prefix (e.g. `close-line` → `RiCloseLine`,
`user-3-line` → `RiUser3Line`).

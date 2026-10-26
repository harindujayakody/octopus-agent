/**
 * Shardx UI Kit — public entry point.
 *
 * Consume from another project:
 *   import { Button, ThemeProvider } from 'shardx-ui-kit'
 *   import 'shardx-ui-kit/styles.css'
 */
export * from './components'
export * as Icons from './icons'
export { ThemeProvider, useTheme } from './theme/ThemeProvider'
export { default as ThemeToggle } from './theme/ThemeToggle'
export type { Theme, ResolvedTheme } from './theme/ThemeProvider'
export { LinkProvider, Link, useLinkComponent } from './lib/link'
export type { LinkComponent, LinkComponentProps } from './lib/link'
export { cn } from './lib/cn'
export { LabelsProvider, useLabels, DEFAULT_LABELS, fill } from './lib/labels'
export type { KitLabels } from './lib/labels'
export { ICON_STROKE } from './lib/icons'
export { toAriaKeyShortcuts, letterOf, digitOf } from './lib/keys'
export * from './lib/overlay'
export * from './lib/virtual'
export * from './lib/list'
export * from './lib/focus'
export * from './lib/motion'

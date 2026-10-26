import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

type ThemeContextValue = {
  /** The chosen theme, the one that is stored. */
  theme: Theme
  /** A theme shown without being stored (a settings page before Save), or null. */
  previewTheme: Theme | null
  systemTheme: ResolvedTheme
  /** What is on screen: the preview when there is one, else the chosen theme. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  /** Shows `theme` without storing it; null shows the chosen theme again. */
  setPreviewTheme: (theme: Theme | null) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'shardx-ui-kit-theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  // A blocked storage (a private window, a policy) throws: follow the system.
  let stored: string | null = null
  try { stored = window.localStorage.getItem(STORAGE_KEY) } catch { /* blocked */ }
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(mql.matches ? 'dark' : 'light')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const shown = previewTheme ?? theme
  const resolvedTheme: ResolvedTheme = shown === 'system' ? systemTheme : shown

  // Only the chosen theme is stored: a preview is never written.
  useLayoutEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, theme) } catch { /* blocked: kept until reload */ }
  }, [theme])

  // A theme change snaps (PERF-07): transitions are off while the attribute
  // flips and for the next two frames, set before paint so no frame mixes
  // the two themes.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme-switching', '')
    root.setAttribute('data-theme', resolvedTheme)
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => root.removeAttribute('data-theme-switching'))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      root.removeAttribute('data-theme-switching')
    }
  }, [resolvedTheme])

  // Choosing a theme ends any preview: the choice is what shows.
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    setPreviewTheme(null)
  }, [])
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const current = prev === 'system' ? getSystemTheme() : prev
      return current === 'dark' ? 'light' : 'dark'
    })
    setPreviewTheme(null)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, previewTheme, systemTheme, resolvedTheme, setTheme, setPreviewTheme, toggleTheme }),
    [theme, previewTheme, systemTheme, resolvedTheme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

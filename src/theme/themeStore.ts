import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { useAppSettings } from '../store/appSettings'
import { ACCENTS } from './accents'
import { getTheme2d, type Theme2D } from './theme2d'
import { getTheme3d, type Theme3D } from './theme3d'

export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  resolved: ResolvedTheme
  theme: Theme2D
  theme3d: Theme3D
}

/**
 * Resolved theme + derived palettes for canvas/GL consumers (which can't read
 * CSS vars). Default-initialized to light/blue so importing in node is safe;
 * initTheming() re-syncs it from app settings at startup.
 */
export const useThemeStore = create<ThemeState>()(() => ({
  resolved: 'light',
  theme: getTheme2d('light', 'blue'),
  theme3d: getTheme3d('light'),
}))

/**
 * Wire settings + OS scheme to the theme: stamps <html data-theme=...>, sets
 * the --accent/--accent-soft CSS vars (the rest of the CSS tokens key off
 * data-theme), and refreshes useThemeStore. Re-runs on theme/accent settings
 * changes and on OS scheme flips. Returns an unsubscribe; no-op in node.
 */
export function initTheming(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const apply = (): void => {
    const { theme, accent } = useAppSettings.getState()
    const resolved: ResolvedTheme =
      theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    document.documentElement.dataset.theme = resolved
    const a = ACCENTS[accent]
    document.documentElement.style.setProperty('--accent', a[resolved])
    document.documentElement.style.setProperty(
      '--accent-soft',
      resolved === 'dark' ? a.softDark : a.softLight,
    )
    useThemeStore.setState({
      resolved,
      theme: getTheme2d(resolved, accent),
      theme3d: getTheme3d(resolved),
    })
  }

  apply()

  const unsubSettings = useAppSettings.subscribe(
    (s) => [s.theme, s.accent] as const,
    apply,
    { equalityFn: shallow },
  )
  media.addEventListener('change', apply)
  return () => {
    unsubSettings()
    media.removeEventListener('change', apply)
  }
}

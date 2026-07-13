import type { AccentId } from '../store/appSettings'

export interface AccentColors {
  /** Solid accent on light surfaces. */
  light: string
  /** Solid accent on dark surfaces (lifted for contrast). */
  dark: string
  /** Translucent selection glow over light paper. */
  softLight: string
  /** Translucent selection glow over dark paper. */
  softDark: string
  /** Text ON the light accent — WCAG AA (≥4.5:1) pinned by accentContrast.test. */
  contrastLight: string
  /** Text ON the dark accent (lifted accents are bright: usually dark ink). */
  contrastDark: string
  /** Human-readable label for settings UI. */
  name: string
}

/** Near-black ink for bright accent fills (white fails AA on most). */
const INK = '#030712'
const WHITE = '#ffffff'

export const ACCENTS: Record<AccentId, AccentColors> = {
  blue: {
    light: '#2563EB',
    dark: '#3B82F6',
    softLight: 'rgba(37, 99, 235, 0.30)',
    softDark: 'rgba(59, 130, 246, 0.35)',
    contrastLight: WHITE,
    contrastDark: INK,
    name: 'Blue',
  },
  violet: {
    light: '#7C3AED',
    dark: '#8B5CF6',
    softLight: 'rgba(124, 58, 237, 0.30)',
    softDark: 'rgba(139, 92, 246, 0.35)',
    contrastLight: WHITE,
    contrastDark: INK,
    name: 'Violet',
  },
  green: {
    light: '#059669',
    dark: '#10B981',
    softLight: 'rgba(5, 150, 105, 0.30)',
    softDark: 'rgba(16, 185, 129, 0.35)',
    contrastLight: INK,
    contrastDark: INK,
    name: 'Green',
  },
  amber: {
    light: '#D97706',
    dark: '#F59E0B',
    softLight: 'rgba(217, 119, 6, 0.30)',
    softDark: 'rgba(245, 158, 11, 0.35)',
    contrastLight: INK,
    contrastDark: INK,
    name: 'Amber',
  },
  rose: {
    light: '#E11D48',
    dark: '#F43F5E',
    softLight: 'rgba(225, 29, 72, 0.30)',
    softDark: 'rgba(244, 63, 94, 0.35)',
    contrastLight: WHITE,
    contrastDark: INK,
    name: 'Rose',
  },
  teal: {
    light: '#0D9488',
    dark: '#14B8A6',
    softLight: 'rgba(13, 148, 136, 0.30)',
    softDark: 'rgba(20, 184, 166, 0.35)',
    contrastLight: INK,
    contrastDark: INK,
    name: 'Teal',
  },
}

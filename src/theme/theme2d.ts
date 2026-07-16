import type { AccentId } from '../store/appSettings'
import { ACCENTS } from './accents'

/** Visual tokens for the 2D editor canvas (paper, ink, symbols, overlays). */
export interface Theme2D {
  paper: string
  gridMinor: string
  gridMajor: string
  wall: string
  accent: string
  accentSoft: string
  snap: string
  guide: string
  invalid: string
  text: string
  textMuted: string
  pillBg: string
  pillBorder: string
  symbolBody: string
  symbolLine: string
  symbolDetail: string
  handleFill: string
  /** Muted room fills, cycled by room id. */
  roomFills: readonly string[]
}

type BaseTheme2D = Omit<Theme2D, 'accent' | 'accentSoft'>

const LIGHT: BaseTheme2D = {
  paper: '#FAFAF7',
  gridMinor: 'rgba(0, 0, 0, 0.05)',
  gridMajor: 'rgba(0, 0, 0, 0.11)',
  wall: '#3D3D3D',
  snap: '#10B981',
  guide: '#EC4899',
  invalid: '#EF4444',
  text: '#1F2937',
  textMuted: '#6B7280',
  pillBg: '#FFFFFF',
  pillBorder: '#E5E7EB',
  symbolBody: '#FFFFFF',
  symbolLine: '#6B7280',
  symbolDetail: '#9CA3AF',
  handleFill: '#FFFFFF',
  roomFills: ['#F3EEE4', '#EAE7F2', '#E4EEE9', '#F2E9E4', '#E4EAF2', '#F0F2E4'],
}

/**
 * Same six room hues as light, lifted over the dark paper. Retuned for the
 * B9 0.5.0 contrast pass — theme2d.test.ts pins the floors (room fills vs
 * paper, symbol detail vs body, pill border vs bg, grid alphas) so future
 * shade tweaks fail tests before they fail eyes. Symbol/furniture identity
 * stays aligned with light mode (user rule): hues and roles unchanged,
 * only contrast lifts.
 */
const DARK: BaseTheme2D = {
  paper: '#1b1c1f',
  gridMinor: 'rgba(255, 255, 255, 0.09)',
  gridMajor: 'rgba(255, 255, 255, 0.17)',
  wall: '#cfd2d6',
  snap: '#34d399',
  guide: '#f472b6',
  invalid: '#f87171',
  text: '#e8eaed',
  textMuted: '#9aa0a8',
  pillBg: '#26282c',
  pillBorder: '#4d5157',
  symbolBody: '#26282c',
  symbolLine: '#9aa0a8',
  symbolDetail: '#868d96',
  handleFill: '#26282c',
  roomFills: ['#453e2e', '#3d3852', '#33453a', '#4a3833', '#333c55', '#42452e'],
}

export function getTheme2d(resolved: 'light' | 'dark', accent: AccentId): Theme2D {
  const a = ACCENTS[accent]
  return resolved === 'dark'
    ? { ...DARK, accent: a.dark, accentSoft: a.softDark }
    : { ...LIGHT, accent: a.light, accentSoft: a.softLight }
}

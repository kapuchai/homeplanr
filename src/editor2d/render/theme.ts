/** Visual theme tokens for the 2D editor and app chrome (light "paper" theme). */
export const theme = {
  paper: '#FAFAF7',
  gridMinor: 'rgba(0, 0, 0, 0.05)',
  gridMajor: 'rgba(0, 0, 0, 0.11)',
  wall: '#3D3D3D',
  accent: '#2563EB',
  accentSoft: 'rgba(37, 99, 235, 0.35)',
  snap: '#10B981',
  guide: '#EC4899',
  invalid: '#EF4444',
  text: '#1F2937',
  textMuted: '#6B7280',
  panelBg: '#FFFFFF',
  panelBorder: '#E5E7EB',
  /** Muted warm room fills, cycled by room id. */
  roomFills: ['#F3EEE4', '#EAE7F2', '#E4EEE9', '#F2E9E4', '#E4EAF2', '#F0F2E4'],
} as const

export type Theme = typeof theme

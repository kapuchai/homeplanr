import { describe, expect, it } from 'vitest'
import { en } from './en'
import { t } from './index'

describe('i18n seam (M7, 0.4.0)', () => {
  it('t() interpolates {param} placeholders, including repeats', () => {
    expect(t('menu.newTemplate', { name: 'Studio 25 m²' })).toBe('New: Studio 25 m²')
    expect(t('export.overflow.message', { scale: '1:50', paper: 'A4' })).toBe(
      'At 1:50 the plan overflows A4 — only the top-left region would print.',
    )
    // repeated placeholder (recovery message uses {name} twice across keys)
    expect(t('persist.recovery.competing', { name: 'Flat' })).toContain('“Flat” unopened')
  })

  it('every value is non-empty and placeholders are well-formed', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, key).toBeGreaterThan(0)
      // braces only ever appear as {identifier} placeholder tokens
      const stripped = value.replace(/\{[a-zA-Z][a-zA-Z0-9]*\}/g, '')
      expect(stripped.includes('{'), `${key}: malformed placeholder in "${value}"`).toBe(false)
      expect(stripped.includes('}'), `${key}: malformed placeholder in "${value}"`).toBe(false)
    }
  })

  it('keys are dot-namespaced by surface', () => {
    for (const key of Object.keys(en)) {
      expect(key, key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/)
    }
  })
})

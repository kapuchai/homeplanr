import { describe, expect, it } from 'vitest'
import { pickDefaultDir } from './defaultDirs'

const sys = { downloads: '/home/u/Downloads', documents: '/home/u/Documents' }

describe('pickDefaultDir (B7 dialog-directory policy)', () => {
  it('exports default to Downloads; saves and opens to Documents', () => {
    expect(pickDefaultDir('export', null, sys)).toBe(sys.downloads)
    expect(pickDefaultDir('save', null, sys)).toBe(sys.documents)
    expect(pickDefaultDir('open', null, sys)).toBe(sys.documents)
  })

  it('a remembered directory beats the system default for every kind', () => {
    expect(pickDefaultDir('export', '/mnt/plans', sys)).toBe('/mnt/plans')
    expect(pickDefaultDir('save', '/mnt/plans', sys)).toBe('/mnt/plans')
    expect(pickDefaultDir('open', '/mnt/plans', sys)).toBe('/mnt/plans')
  })
})

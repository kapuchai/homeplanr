import type { Level } from '../model/types'
import { t } from '../i18n'

/** Chrome display name for a storey: the user's label, else "Floor N" by
 * stack position (docs stay chrome-free — the room-label fallback rule). */
export function levelDisplayName(level: Level, index: number): string {
  return level.name ?? t('levels.floorN', { n: index + 1 })
}

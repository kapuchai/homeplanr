import { en } from './en'

/**
 * Minimal i18n seam (M7, 0.4.0) — no library. English is the only table;
 * the seam exists so chrome strings live in one file and a future locale
 * is a new table + a switch, not a 25-file hunt.
 *
 * Keys are typed: a missing key is a COMPILE error, not a runtime fallback.
 */
export type MessageKey = keyof typeof en

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let out: string = en[key]
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v))
    }
  }
  return out
}

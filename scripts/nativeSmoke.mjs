#!/usr/bin/env node
/**
 * Tier 1 native smoke (0.5.0, testing rig): drives the REAL release binary
 * through tauri-driver → WebKitWebDriver (W3C WebDriver) — the only way
 * this box can screenshot/inspect the actual WebKitGTK window (Wayland
 * locks down compositor capture). Exercises what Tier 0 (browser
 * Playwright) cannot: real IPC (window title), the argv file-association
 * cold-start path (fs-scope grant + parked launch file), and real
 * WebKitGTK rendering.
 *
 * Preconditions (documented in RUNBOOK):
 * - fresh release binary: npm run tauri build   (or -- --no-bundle)
 * - tauri-driver: cargo install tauri-driver    (user-space, ~/.cargo/bin)
 * - /usr/bin/WebKitWebDriver (webkitgtk package)
 * - NO homeplanr instance already running (single-instance would relay
 *   the launch into it and exit)
 *
 * Zero npm deps by design — plain `node scripts/nativeSmoke.mjs`.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(new URL('.', import.meta.url).pathname, '..')
const APP = process.env.SMOKE_APP ?? join(ROOT, 'src-tauri/target/release/homeplanr')
const DRIVER = process.env.TAURI_DRIVER ?? join(homedir(), '.cargo/bin/tauri-driver')
// NB: 4445 is WebKitWebDriver's slot (tauri-driver --native-port default);
// the intermediary must not squat it
const PORT = Number(process.env.SMOKE_PORT ?? 4444)
const BASE = `http://127.0.0.1:${PORT}`

let failures = 0
const ok = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => {
  failures += 1
  console.error(`  ✗ ${msg}`)
}

if (!existsSync(APP)) {
  console.error(`release binary missing: ${APP}`)
  console.error('build it first: npm run tauri build -- --no-bundle')
  process.exit(2)
}
if (!existsSync(DRIVER)) {
  console.error(`tauri-driver missing: ${DRIVER} (cargo install tauri-driver)`)
  process.exit(2)
}

// fixture: a bundled template plan, opened via argv like a double-click
const dir = mkdtempSync(join(tmpdir(), 'homeplanr-smoke-'))
const plan = join(dir, 'Smoke test.homeplanr')
copyFileSync(join(ROOT, 'src/assets/templates/studio-25.homeplanr'), plan)

const driver = spawn(DRIVER, ['--port', String(PORT)], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const req = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${method} ${path} → ${JSON.stringify(j).slice(0, 200)}`)
  return j.value
}

console.log(`native smoke: ${APP}`)
let sid = null
try {
  // driver readiness: /status polls until the intermediary is listening
  let up = false
  for (let i = 0; i < 20 && !up; i++) {
    await sleep(500)
    up = await fetch(`${BASE}/status`).then((r) => r.ok, () => false)
  }
  if (!up) throw new Error('tauri-driver never came up (port busy? WebKitWebDriver missing?)')
  const session = await req('POST', '/session', {
    capabilities: {
      alwaysMatch: { 'tauri:options': { application: APP, args: [plan] } },
    },
  })
  sid = session.sessionId
  ok(`session up (${session.capabilities?.browserName} ${session.capabilities?.browserVersion})`)
  await sleep(3500) // window + parked launch file + first paint

  const exec = (script) => req('POST', `/session/${sid}/execute/sync`, { script, args: [] })

  // the argv file's DOC NAME in the project field proves the whole
  // file-association cold-start path: Rust parked the launch file, granted
  // fs scope, the frontend took it over IPC and parsed it. (W3C GET /title
  // returns the webview's document.title, NOT the GTK window title — the
  // native title can't be asserted through WebDriver.)
  const docName = await exec(
    "return document.querySelector('.toolbar .project-name input')?.value",
  )
  if (docName === 'Studio 25 m²') ok(`argv file opened (doc name '${docName}')`)
  else fail(`argv file should open the template, doc name: ${JSON.stringify(docName)}`)
  const brand = await exec("return document.querySelector('.toolbar .brand')?.textContent")
  if (brand === 'homeplanr') ok('toolbar rendered')
  else fail(`toolbar brand: ${JSON.stringify(brand)}`)

  const rooms = await exec(
    "return [...document.querySelectorAll('svg.editor-canvas text')].filter((t) => (t.textContent ?? '').includes('m²')).length",
  )
  if (rooms >= 2) ok(`plan rendered (${rooms} room labels)`)
  else fail(`expected ≥2 room labels, got ${rooms}`)

  const banner = await exec("return !!document.querySelector('.gl-banner')")
  if (banner) fail('WebGL failure banner is visible')
  else ok('no WebGL failure banner')

  // real WebKitGTK frame for the record (Read the PNG when in doubt)
  const shot = Buffer.from(await req('GET', `/session/${sid}/screenshot`), 'base64')
  const out = join(dir, 'native-smoke.png')
  writeFileSync(out, shot)
  if (shot.byteLength > 30_000) ok(`screenshot ${Math.round(shot.byteLength / 1024)} KB → ${out}`)
  else fail(`screenshot suspiciously small (${shot.byteLength} B) → ${out}`)
} catch (err) {
  fail(String(err))
} finally {
  if (sid) await req('DELETE', `/session/${sid}`).catch(() => {})
  driver.kill()
}

if (failures > 0) {
  console.error(`native smoke: ${failures} failure(s)`)
  process.exit(1)
}
console.log('native smoke: all green')

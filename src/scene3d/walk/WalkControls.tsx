import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3, type EulerOrder } from 'three'
import type { ProjectDocument } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'
import { useUiStore } from '../../store/uiStore'
import { useAppSettings } from '../../store/appSettings'
import { useConfirmStore } from '../../app/confirmStore'
import { useWalkStore } from './walkStore'
import {
  LOCK_DEADMAN_MS,
  attemptLock,
  lockVerdict,
  markLockDead,
  noteLockedMove,
  resetLockProbe,
} from './pointerLock'
import { EYE_HEIGHT, getCollisionSet, resolveMove } from './collision'
import {
  clampPitch,
  eyePoseFor,
  moveDelta,
  planToWorld,
  smoothstep,
  type MoveKeys,
} from './walkMath'

/**
 * First-person walk mode (M6), mounted INSIDE the Canvas. Enter/teleport/
 * exit are eased glides driven by useFrame; the frameloop is switched to
 * 'always' for the whole walking span and back to 'demand' on exit. Input
 * is buffered out during glides: mid-glide clicks are consumed and
 * dropped, keys and looks apply only while free-walking.
 *
 * Look (0.11.0): Pointer Lock FPS look when the platform proves it works,
 * capture-drag otherwise — both feed the same yaw/pitch core. Lock is
 * opportunistic (see pointerLock.ts): requested on walk enter and again
 * on every canvas press, while drag capture stays armed regardless, so a
 * request that never engages costs nothing. An unexpected unlock is
 * disambiguated by focus: Esc under lock (consumed by the browser)
 * leaves the document focused and exits walk; a focus loss (alt-tab,
 * compositor grab) keeps walking with look degraded to drag until the
 * next press re-locks. An UNPROVEN lock that stays silent for
 * LOCK_DEADMAN_MS is declared dead and released (still walking).
 *
 * Exit paths (all restore the orbit pose, rotation order, frameloop, and
 * reset the walk store): Esc / the overlay Walk button glide back 0.5s;
 * a viewMode switch to 2D and unmount (context-loss epoch remount)
 * restore instantly.
 */
/** Base look sensitivity — multiplied by the lookSensitivity device pref. */
const LOOK_SENSITIVITY = 0.0032
const ENTER_GLIDE_S = 0.65
const GLIDE_S = 0.5
const MAX_FRAME_DT = 0.05

/** Structural view of drei's makeDefault OrbitControls (state.controls). */
interface OrbitLike {
  enabled: boolean
  target: Vector3
  update: () => void
}

interface SavedPose {
  position: Vector3
  quaternion: Quaternion
  order: EulerOrder
  target: Vector3
}

interface Glide {
  kind: 'enter' | 'teleport' | 'exit'
  t: number
  dur: number
  fromPos: Vector3
  toPos: Vector3
  /** null quats (teleport) keep the current orientation. */
  fromQuat: Quaternion | null
  toQuat: Quaternion | null
  /** Plan-space landing point for enter/teleport. */
  endPlan: Vec2 | null
}

const freshKeys = (): MoveKeys => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
})

export function WalkControls({
  doc,
  derived,
}: {
  doc: ProjectDocument
  derived: DerivedGeometry
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  const setFrameloop = useThree((s) => s.setFrameloop)
  const invalidate = useThree((s) => s.invalidate)
  const mode = useWalkStore((s) => s.mode)

  const pose = useRef<SavedPose | null>(null)
  const glide = useRef<Glide | null>(null)
  const plan = useRef<Vec2>({ x: 0, y: 0 })
  const yaw = useRef(0)
  const pitch = useRef(0)
  const keys = useRef<MoveKeys>(freshKeys())
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const exitRequested = useRef(false)
  /** Set before OUR exitPointerLock calls — a self-inflicted unlock must
   * not be mistaken for the user's native Esc (which exits walk). */
  const expectedUnlock = useRef(false)

  const beginEnter = (target: Vec2) => {
    pose.current = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      order: camera.rotation.order,
      target: controls ? controls.target.clone() : new Vector3(),
    }
    const dir = camera.getWorldDirection(new Vector3())
    const eye = eyePoseFor(
      [camera.position.x, camera.position.y, camera.position.z],
      { x: dir.x, z: dir.z },
      target,
    )
    // order first, then drive the quaternion — the linked euler re-syncs as YXZ
    camera.rotation.order = 'YXZ'
    yaw.current = eye.yaw
    pitch.current = eye.pitch
    plan.current = { x: target.x, y: target.y }
    glide.current = {
      kind: 'enter',
      t: 0,
      dur: ENTER_GLIDE_S,
      fromPos: pose.current.position.clone(),
      toPos: new Vector3(...planToWorld(target, EYE_HEIGHT)),
      fromQuat: pose.current.quaternion.clone(),
      toQuat: new Quaternion().setFromEuler(new Euler(eye.pitch, eye.yaw, 0, 'YXZ')),
      endPlan: target,
    }
  }

  const beginTeleport = (target: Vec2) => {
    glide.current = {
      kind: 'teleport',
      t: 0,
      dur: GLIDE_S,
      fromPos: camera.position.clone(),
      toPos: new Vector3(...planToWorld(target, EYE_HEIGHT)),
      fromQuat: null,
      toQuat: null,
      endPlan: target,
    }
  }

  const finishRestore = () => {
    const saved = pose.current
    if (saved) {
      camera.rotation.order = saved.order
      camera.position.copy(saved.position)
      camera.quaternion.copy(saved.quaternion)
      if (controls) {
        controls.target.copy(saved.target)
        controls.update()
      }
    }
    pose.current = null
    glide.current = null
    keys.current = freshKeys()
    drag.current = null
    exitRequested.current = false
    const walk = useWalkStore.getState()
    walk._consumeTarget()
    walk.setHint(null)
    walk._setMode('off')
    setFrameloop('demand')
    invalidate()
  }

  const beginExit = () => {
    const saved = pose.current
    if (!saved) {
      finishRestore()
      return
    }
    glide.current = {
      kind: 'exit',
      t: 0,
      dur: GLIDE_S,
      fromPos: camera.position.clone(),
      toPos: saved.position.clone(),
      fromQuat: camera.quaternion.clone(),
      toQuat: saved.quaternion.clone(),
      endPlan: null,
    }
  }

  const instantRestore = () => {
    if (useWalkStore.getState().mode === 'off' && !pose.current) return
    finishRestore()
  }

  // latest-impl refs so subscriptions/cleanup never call stale closures
  const finishRestoreRef = useRef(finishRestore)
  finishRestoreRef.current = finishRestore
  const beginExitRef = useRef(beginExit)
  beginExitRef.current = beginExit
  const instantRestoreRef = useRef(instantRestore)
  instantRestoreRef.current = instantRestore

  // store bridges: frameloop kick on enter, exit requests, 2D bail-out
  useEffect(() => {
    const unsubMode = useWalkStore.subscribe(
      (s) => s.mode,
      (m) => {
        if (m === 'walking') {
          setFrameloop('always')
          invalidate()
        }
      },
    )
    const unsubExit = useWalkStore.subscribe(
      (s) => s.exitSeq,
      () => {
        if (useWalkStore.getState().mode === 'walking') {
          exitRequested.current = true
          invalidate() // make sure a frame runs to pick the request up
        }
      },
    )
    const unsubView = useUiStore.subscribe(
      (s) => s.viewMode,
      (m) => {
        if (m === '2d') instantRestoreRef.current()
      },
    )
    return () => {
      unsubMode()
      unsubExit()
      unsubView()
    }
  }, [setFrameloop, invalidate])

  // unmount (context-loss epoch remount / app teardown): instant restore
  useEffect(() => () => instantRestoreRef.current(), [])

  // keyboard: movement keys + Esc, active whenever walk mode is armed/on
  const active = mode !== 'off'
  useEffect(() => {
    if (!active) return
    // keep in sync with keymap.ts's modal guard — every app modal must
    // swallow walk keys too (WASD walking behind a dialog is disorienting)
    const modalOpen = () => {
      const ui = useUiStore.getState()
      return (
        useConfirmStore.getState().pending !== null ||
        ui.optionsOpen ||
        ui.exportOpen ||
        ui.helpOpen
      )
    }
    const editable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
    const setKey = (code: string, down: boolean): boolean => {
      const k = keys.current
      switch (code) {
        case 'KeyW':
        case 'ArrowUp':
          k.forward = down
          return true
        case 'KeyS':
        case 'ArrowDown':
          k.back = down
          return true
        case 'KeyA':
        case 'ArrowLeft':
        case 'KeyQ':
          k.left = down
          return true
        case 'KeyD':
        case 'ArrowRight':
        case 'KeyE':
          k.right = down
          return true
        case 'ShiftLeft':
        case 'ShiftRight':
          k.sprint = down
          return true
        default:
          return false
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen() || editable(e.target)) return
      if (e.key === 'Escape') {
        useWalkStore.getState().exit()
        return
      }
      if (setKey(e.code, true) && useWalkStore.getState().mode === 'walking') e.preventDefault()
    }
    // keyup is never guarded — a key released behind a modal must not stick
    const onKeyUp = (e: KeyboardEvent) => setKey(e.code, false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      keys.current = freshKeys()
    }
  }, [active])

  // look: Pointer Lock when it works, capture-drag otherwise (see the
  // component docblock and pointerLock.ts for the probe contract)
  useEffect(() => {
    if (mode !== 'walking') return
    const el = gl.domElement
    const dom = el.ownerDocument
    const isLocked = () => dom.pointerLockElement === el
    let deadmanId: number | null = null
    const clearDeadman = () => {
      if (deadmanId !== null) {
        window.clearTimeout(deadmanId)
        deadmanId = null
      }
    }
    const applyLook = (dx: number, dy: number) => {
      // live getState read — a mid-walk Options change applies instantly
      const sens = LOOK_SENSITIVITY * useAppSettings.getState().lookSensitivity
      yaw.current -= dx * sens
      pitch.current = clampPitch(pitch.current - dy * sens)
      camera.rotation.set(pitch.current, yaw.current, 0)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || glide.current) return
      if (isLocked()) return // FPS look: no drag to arm, clicks stay inert
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
      // the press is the user-activation carrier
      attemptLock(el, useAppSettings.getState().lookMode)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (glide.current) return
      if (isLocked()) {
        clearDeadman() // an event arrived — the channel is alive
        if (noteLockedMove(e.movementX, e.movementY) === 'broken') {
          // lock engaged but deltas are dead — release WITHOUT exiting walk
          expectedUnlock.current = true
          dom.exitPointerLock()
          return
        }
        applyLook(e.movementX, e.movementY)
        return
      }
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      applyLook(dx, dy)
    }
    const endDrag = (e: PointerEvent) => {
      if (drag.current?.pointerId !== e.pointerId) return
      drag.current = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    /** Mirror the lock into the store; while locked, drop any drag armed
     * by the same press and start the deadman on unproven platforms (a
     * lock that never emits a single move event is holding the pointer
     * hostage; a proven-'ok' lock is exempt — an idle mouse emits
     * nothing). Shared by the change handler AND mount normalization —
     * mount must NOT run the unlock exit heuristic below. */
    const syncLockedState = (): boolean => {
      const locked = isLocked()
      useWalkStore.getState()._setLocked(locked)
      if (!locked) return false
      const d = drag.current
      drag.current = null
      if (d && el.hasPointerCapture(d.pointerId)) el.releasePointerCapture(d.pointerId)
      if (lockVerdict() !== 'ok') {
        deadmanId = window.setTimeout(() => {
          deadmanId = null
          markLockDead()
          expectedUnlock.current = true
          dom.exitPointerLock()
        }, LOCK_DEADMAN_MS)
      }
      return true
    }
    const onLockChange = () => {
      resetLockProbe()
      clearDeadman()
      if (syncLockedState()) return
      if (expectedUnlock.current) {
        expectedUnlock.current = false
        return
      }
      // Unexpected unlock: Esc under lock (consumed by the browser — it
      // never reaches our keydown handler) leaves the document focused
      // and must exit walk; a focus loss (alt-tab, compositor grab)
      // keeps walking — look degrades to drag until the next press.
      if (dom.hasFocus() && useWalkStore.getState().mode === 'walking') {
        useWalkStore.getState().exit()
      }
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    dom.addEventListener('pointerlockchange', onLockChange)
    // The entering floor click requests the lock INSIDE its own handler
    // (WebKitGTK refuses deferred requests — see handleFloorClick); this
    // deferred attempt is the harmless second chance for lenient engines.
    attemptLock(el, useAppSettings.getState().lookMode)
    // The click's lock can engage BEFORE this effect attached the
    // listener — sync the flag instead of trusting the missed event.
    syncLockedState()
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      dom.removeEventListener('pointerlockchange', onLockChange)
      clearDeadman()
      drag.current = null
      expectedUnlock.current = false
      if (isLocked()) dom.exitPointerLock()
      useWalkStore.getState()._setLocked(false) // listener is gone — reset ourselves
    }
  }, [mode, gl, camera])

  useFrame((_, delta) => {
    const walk = useWalkStore.getState()
    if (walk.mode !== 'walking' && !glide.current) return

    // consume queued clicks up front; mid-glide ones are dropped
    const target = walk.pendingTarget ? walk._consumeTarget() : null

    const g = glide.current
    if (g) {
      if (exitRequested.current && g.kind !== 'exit') {
        // Esc mid-glide: bail out from the current mid-flight pose
        exitRequested.current = false
        beginExitRef.current()
        return
      }
      g.t += delta
      const k = smoothstep(g.t / g.dur)
      camera.position.lerpVectors(g.fromPos, g.toPos, k)
      if (g.fromQuat && g.toQuat) camera.quaternion.slerpQuaternions(g.fromQuat, g.toQuat, k)
      if (g.t >= g.dur) {
        glide.current = null
        if (g.kind === 'exit') {
          finishRestoreRef.current()
        } else {
          if (g.endPlan) plan.current = { x: g.endPlan.x, y: g.endPlan.y }
          camera.position.set(...planToWorld(plan.current, EYE_HEIGHT))
          camera.rotation.set(pitch.current, yaw.current, 0)
        }
      }
      return
    }

    if (exitRequested.current) {
      exitRequested.current = false
      beginExitRef.current()
      return
    }

    if (target) {
      if (!pose.current) beginEnter(target)
      else beginTeleport(target)
      return
    }

    // free walking: substepped collision slide in plan space (the 0.11.0
    // collision toggle bypasses the resolve entirely — walls stop nothing)
    const dt = Math.min(delta, MAX_FRAME_DT)
    const d = moveDelta(keys.current, yaw.current, dt)
    if (d.x !== 0 || d.y !== 0) {
      plan.current = useAppSettings.getState().collisionEnabled
        ? resolveMove(getCollisionSet(doc, derived), plan.current, d)
        : { x: plan.current.x + d.x, y: plan.current.y + d.y }
    }
    camera.position.set(...planToWorld(plan.current, EYE_HEIGHT))
    camera.rotation.set(pitch.current, yaw.current, 0)
  })

  return null
}

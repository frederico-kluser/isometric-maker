// @ts-nocheck — vendored pelo shadcn CLI; não edite (regra 6 da skill motion-plus-ui).
import { animate } from "motion/react"
import type { DOMKeyframesDefinition } from "motion/react"
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react"
import { useMotionUITheme } from "@/components/motion-ui/ui-theme"

/**
 * ==============   Constants   ================
 */

// The burst's physical shape. These are tuned constants of the mechanic (WHERE
// and HOW the pieces travel), not timing - the whole track is authored as
// explicit keyframes and played at a fixed linear rate below.
const CONFETTI_DURATION = 1.6
const CONFETTI_DECAY = 0.91
const CONFETTI_GRAVITY = 1
const CONFETTI_DRIFT = 0
const CONFETTI_SIZE = 0.85
const CONFETTI_KEYFRAME_STEPS = 40
const CONFETTI_SCALE_DURATION_FRACTION = 0.08
const CONFETTI_SHAPES: ConfettiParticleData["shape"][] = [
  "circle",
  "rect",
  "rect",
  "strip",
  "strip",
]

// Live var()/color-mix references, not resolved hexes - each particle's fill
// resolves against whichever --primary/--foreground the wrapping theme
// currently cascades. The middle entry is a brighter tint of --primary,
// blended toward --foreground so it lightens in dark mode and deepens in
// light mode.
const CONFETTI_COLORS = [
  "var(--primary)",
  "color-mix(in srgb, var(--primary) 70%, var(--foreground))",
  "var(--foreground)",
]

/* Reduced motion: the theme's "off" and "calm" strategies both suppress the
 * celebration - a burst has no calm form, so it is dropped, not faded. */

/**
 * ==============   Types   ================
 */

/** One confetti piece's fully pre-computed animation track: the transform +
 *  opacity keyframes it plays, how long the play takes, and its static shape,
 *  size and (live `var()`) fill. Returned by `buildConfettiParticles` and
 *  consumed by `ConfettiPiece`. */
export interface ConfettiParticleData {
  /** The `{ transform, opacity }` keyframe arrays the piece animates through,
   *  pre-computed so the whole flight runs on the compositor. */
  keyframes: DOMKeyframesDefinition
  /** Play length of the keyframe track, in seconds. */
  duration: number
  /** The piece's base size in px (its width/height derive from this + shape). */
  size: number
  /** Fill colour - a live `var()`/`color-mix` reference, not a resolved hex,
   *  so the active theme recolours it. */
  color: string
  /** The piece's silhouette: a dot, a small rectangle, or a thin streamer. */
  shape: "circle" | "rect" | "strip"
}

/** One fired burst: a stable id (for keyed cleanup) and the particles it
 *  spawned. */
export interface ConfettiBurst {
  /** Stable id for the burst, used to remove it once it settles. */
  id: number
  /** The particles this burst spawned. */
  particles: ConfettiParticleData[]
}

/** The imperative handle a consumer drives through `ref` to fire a burst. */
export interface ConfettiHandle {
  /** Fire one celebration burst from the layer's centre. No-ops under the
   *  theme's reduced-motion strategies ("calm"/"off"). */
  burst: () => void
}

/**
 * ==============   Physics builders   ================
 */

/**
 * Builds `particleCount` confetti particles, each with a randomised launch
 * angle (within `spread` degrees of straight up), initial `startVelocity`,
 * shape, size and live-`var()` colour, and its fully pre-computed keyframe
 * track. Pure - safe to call at the moment of celebration.
 */
export function buildConfettiParticles(
  particleCount: number,
  spread: number,
  startVelocity: number
): ConfettiParticleData[] {
  const ticks = Math.round(CONFETTI_DURATION * 60)

  return Array.from({ length: particleCount }, () => {
    const radSpread = spread * (Math.PI / 180)
    const angle = -Math.PI / 2 + (0.5 * radSpread - Math.random() * radSpread)
    const velocity = startVelocity * 0.5 + Math.random() * startVelocity
    const wobbleSpeed = Math.min(0.11, Math.random() * 0.1 + 0.05)
    const wobbleOffset = Math.random() * 10
    const pieceSize = 6 * CONFETTI_SIZE + Math.random() * 6 * CONFETTI_SIZE
    const tiltRotations = 2 + Math.random() * 4
    const rotation = Math.random() * 360

    const keyframes = computeConfettiKeyframes({
      angle,
      startVelocity: velocity,
      decay: CONFETTI_DECAY,
      gravity: CONFETTI_GRAVITY,
      drift: CONFETTI_DRIFT,
      wobbleSpeed,
      wobbleOffset,
      size: CONFETTI_SIZE,
      ticks,
      tiltRotations,
      rotation,
    })

    return {
      keyframes,
      duration: CONFETTI_DURATION,
      size: pieceSize,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      shape: CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)],
    }
  })
}

/**
 * Simulates one particle's flight tick-by-tick and samples it down to
 * `CONFETTI_KEYFRAME_STEPS` keyframes, returning the `{ transform, opacity }`
 * arrays Motion plays at a linear rate. All motion is a single `translate() +
 * scale() + rotateY() + rotate()` transform per frame, so the whole burst
 * stays compositor-only. Pure.
 */
export function computeConfettiKeyframes(params: {
  angle: number
  startVelocity: number
  decay: number
  gravity: number
  drift: number
  wobbleSpeed: number
  wobbleOffset: number
  size: number
  ticks: number
  tiltRotations: number
  rotation: number
}): DOMKeyframesDefinition {
  const {
    angle,
    startVelocity,
    decay,
    gravity,
    drift,
    wobbleSpeed,
    wobbleOffset,
    size,
    ticks,
    tiltRotations,
    rotation,
  } = params

  const transform: string[] = []
  const opacity: number[] = []

  let velocity = startVelocity
  let x = 0
  let y = 0
  let wobble = wobbleOffset
  let tick = 0

  for (let step = 0; step <= CONFETTI_KEYFRAME_STEPS; step++) {
    const t = step / CONFETTI_KEYFRAME_STEPS

    if (step > 0) {
      const targetTick = Math.round((step * ticks) / CONFETTI_KEYFRAME_STEPS)
      while (tick < targetTick) {
        x += Math.cos(angle) * velocity + drift
        y += Math.sin(angle) * velocity + gravity * 3
        velocity *= decay
        wobble += wobbleSpeed
        tick++
      }
    }

    const wx = step === 0 ? 0 : x + Math.cos(wobble) * 15 * size
    const wy = y

    // Scale: 0 -> 1.15 -> 1 over the first ~8% of the duration.
    let scale: number
    if (t < CONFETTI_SCALE_DURATION_FRACTION * 0.6) {
      scale = (t / (CONFETTI_SCALE_DURATION_FRACTION * 0.6)) * 1.15
    } else if (t < CONFETTI_SCALE_DURATION_FRACTION) {
      const st =
        (t - CONFETTI_SCALE_DURATION_FRACTION * 0.6) /
        (CONFETTI_SCALE_DURATION_FRACTION * 0.4)
      scale = 1.15 - st * 0.15
    } else {
      scale = 1
    }

    const rotateY = tiltRotations * 360 * t

    // Opacity: hold at 1 until 50%, fade to 0.5 at 80%, then to 0.
    let opacityKeyframe: number
    if (t <= 0.5) {
      opacityKeyframe = 1
    } else if (t <= 0.8) {
      opacityKeyframe = 1 - ((t - 0.5) / 0.3) * 0.5
    } else {
      opacityKeyframe = 0.5 - ((t - 0.8) / 0.2) * 0.5
    }

    transform.push(
      `translate(${wx}px, ${wy}px) scale(${scale}) rotateY(${rotateY}deg) rotate(${rotation}deg)`
    )
    opacity.push(opacityKeyframe)
  }

  return { transform, opacity }
}

/**
 * ==============   ConfettiPiece   ================
 */

/**
 * Renders and plays one confetti particle: an absolutely-positioned mark whose
 * width/height/border-radius derive from the piece's shape, animated through
 * its pre-computed keyframe track by a single Motion `animate()` call (which
 * auto-promotes the node to its own layer for the lifetime of the burst and
 * releases it after - no standing `will-change`). Decorative.
 */
export function ConfettiPiece({ particle }: { particle: ConfettiParticleData }) {
  const ref = useRef<HTMLDivElement>(null)
  const { keyframes, duration, size, color, shape } = particle

  const width =
    shape === "strip" ? size * 0.3 : shape === "rect" ? size * 0.7 : size
  const height = shape === "strip" ? size * 2 : size
  const borderRadius =
    shape === "circle" ? "50%" : shape === "strip" ? size * 0.12 : 2

  useEffect(() => {
    if (!ref.current) return
    const controls = animate(ref.current, keyframes, { duration, ease: "linear" })
    return () => controls.cancel()
  }, [])

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        width,
        height,
        borderRadius,
        backgroundColor: color,
        pointerEvents: "none",
      }}
    />
  )
}

/**
 * ==============   Confetti   ================
 */

/** Props for the `Confetti` burst layer. `particleCount`/`spread`/
 *  `startVelocity` shape the burst; `ref` exposes the imperative `burst()`
 *  trigger. */
export interface ConfettiProps {
  /** How many pieces each burst spawns. Default 30. */
  particleCount?: number
  /** The launch cone width in degrees - how wide the pieces fan out from
   *  straight up. Default 90. */
  spread?: number
  /** Initial particle speed - how far the burst throws before gravity and
   *  decay take over. Default 20. */
  startVelocity?: number
  /** Merged onto the burst layer (the `absolute inset-0` container). */
  className?: string
  /** Imperative handle exposing `burst()`. */
  ref?: Ref<ConfettiHandle>
}

/**
 * A `pointer-events-none` layer that fills its nearest positioned ancestor and
 * fires celebration bursts from its centre on demand. Owns the burst lifecycle
 * - id tracking, mounting each burst's particles, and tearing a burst down
 * after it settles - and cleans every pending teardown on unmount. Fire a
 * burst by calling `burst()` on its `ref`.
 */
export function Confetti({
  particleCount = 30,
  spread = 90,
  startVelocity = 20,
  className,
  ref,
}: ConfettiProps) {
  const { motionMode } = useMotionUITheme()
  const motionAllowed = motionMode === "full"
  const [bursts, setBursts] = useState<ConfettiBurst[]>([])
  const nextBurstId = useRef(0)
  const burstTimers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const timers = burstTimers.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      burst: () => {
        if (!motionAllowed) return
        const id = nextBurstId.current++
        setBursts((prev) => [
          ...prev,
          { id, particles: buildConfettiParticles(particleCount, spread, startVelocity) },
        ])
        const cleanupTimer = setTimeout(
          () => {
            setBursts((prev) => prev.filter((burst) => burst.id !== id))
            burstTimers.current.delete(cleanupTimer)
          },
          (CONFETTI_DURATION + 0.5) * 1000
        )
        burstTimers.current.add(cleanupTimer)
      },
    }),
    [motionAllowed, particleCount, spread, startVelocity]
  )

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-20 overflow-visible${className ? ` ${className}` : ""}`}
    >
      {bursts.map((burst) => (
        <div key={burst.id} className="absolute left-1/2 top-1/2">
          {burst.particles.map((particle, i) => (
            <ConfettiPiece key={i} particle={particle} />
          ))}
        </div>
      ))}
    </div>
  )
}

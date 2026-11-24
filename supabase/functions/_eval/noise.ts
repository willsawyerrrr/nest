/**
 * The seeded noise pipeline: how each clean corpus document is degraded into
 * photographed, scanned and screen-captured variants.
 *
 * This file decides every random choice and records it in the manifest; the
 * Swift renderer (`evals/foundation-models`) only applies what the manifest
 * says, so a variant is reproducible from its entry alone. Variants are derived
 * from the clean tier T0 documents and share their labels; T0 itself is never
 * altered.
 */

import { type CorpusDoc, rng } from './corpus.ts'

/** The base seed every variant seed derives from. */
export const NOISE_SEED = 829

/** How a variant came to exist, which decides which operations it can carry. */
export type Profile = 'born-digital' | 'scan' | 'photo' | 'screen'

export const PROFILES: Profile[] = ['born-digital', 'scan', 'photo', 'screen']

/** Operations in the order the renderer applies them. */
export const OP_ORDER = [
  'twoUp',
  'crop',
  'rotate',
  'perspective',
  'lowLight',
  'shadow',
  'blur',
  'moire',
  'speckle',
  'jpeg',
] as const

export type OpName = typeof OP_ORDER[number]

export type NoiseOp =
  /** Stacks the document over `companion`, each scaled to half the page height. */
  | { op: 'twoUp'; companion: string }
  /** Trims each edge by a fraction of the page's width (left, right) or height (top, bottom). */
  | { op: 'crop'; left: number; top: number; right: number; bottom: number }
  /** Turns the page by `degrees` (positive is clockwise) about its centre. */
  | { op: 'rotate'; degrees: number }
  /** Moves each corner (tl, tr, br, bl) by `[dx, dy]` as fractions of the page size. */
  | { op: 'perspective'; corners: [number, number][] }
  /** Multiplies brightness by `factor` (below 1) and flattens contrast by `fade`. */
  | { op: 'lowLight'; factor: number; fade: number }
  /** Darkens one side of a soft-edged line by `strength` (0 to 1); the line runs across the page at `offset` of its extent along `angle` degrees. */
  | { op: 'shadow'; angle: number; strength: number; offset: number }
  /** Gaussian blur of `radius` pixels. */
  | { op: 'blur'; radius: number }
  /** Overlays a sinusoidal screen grid of `period` pixels at `angle` degrees. */
  | { op: 'moire'; period: number; angle: number; strength: number }
  /** Flips `density` of the pixels to black or white, drawn from `seed`. */
  | { op: 'speckle'; density: number; seed: number }
  /** Round-trips the raster through JPEG at `quality` (1 to 100). */
  | { op: 'jpeg'; quality: number }

export interface Variant {
  /** `<document id>.<profile>`; the files are `<id>.png` and `<id>.pdf`. */
  id: string
  /** The clean document the variant is made from, whose label it shares. */
  baseId: string
  profile: Profile
  seed: number
  /** True only when the PDF carries the document's text layer. */
  textLayer: boolean
  ops: NoiseOp[]
}

export interface Manifest {
  seed: number
  variants: Variant[]
}

/** FNV-1a, folding the base seed, document id and profile into one 32-bit seed. */
export function variantSeed(docId: string, profile: Profile): number {
  let hash = 0x811c9dc5 ^ NOISE_SEED
  for (const char of `${docId}.${profile}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  }
  return hash >>> 0
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

type Next = () => number

const between = (next: Next, low: number, high: number): number => low + next() * (high - low)
const signed = (next: Next, low: number, high: number): number =>
  (next() < 0.5 ? -1 : 1) * between(next, low, high)

/** Builders for the operations a profile can include, each reading only `next`. */
const BUILD: Record<OpName, (next: Next, scale: number, companion: string) => NoiseOp> = {
  twoUp: (_next, _scale, companion) => ({ op: 'twoUp', companion }),
  crop: (next) => ({
    op: 'crop',
    left: round(between(next, 0.01, 0.06)),
    top: round(between(next, 0.01, 0.06)),
    right: round(between(next, 0.01, 0.06)),
    bottom: round(between(next, 0.01, 0.06)),
  }),
  rotate: (next, scale) => ({ op: 'rotate', degrees: round(signed(next, 1, 15 * scale), 2) }),
  perspective: (next) => ({
    op: 'perspective',
    corners: Array.from({ length: 4 }, (): [number, number] => [
      round(signed(next, 0.005, 0.06)),
      round(signed(next, 0.005, 0.06)),
    ]),
  }),
  lowLight: (next) => ({
    op: 'lowLight',
    factor: round(between(next, 0.45, 0.8)),
    fade: round(between(next, 0.05, 0.25)),
  }),
  shadow: (next) => ({
    op: 'shadow',
    angle: round(between(next, 0, 180), 1),
    strength: round(between(next, 0.2, 0.5)),
    offset: round(between(next, 0.2, 0.8)),
  }),
  blur: (next) => ({ op: 'blur', radius: round(between(next, 1.5, 4), 2) }),
  moire: (next) => ({
    op: 'moire',
    period: round(between(next, 3, 6), 2),
    angle: round(between(next, 5, 40), 1),
    strength: round(between(next, 0.15, 0.35)),
  }),
  speckle: (next) => ({
    op: 'speckle',
    density: round(between(next, 0.0005, 0.003), 4),
    seed: Math.floor(next() * 2 ** 31),
  }),
  jpeg: (next) => ({ op: 'jpeg', quality: Math.floor(between(next, 30, 61)) }),
}

/**
 * What each profile can carry. A born-digital variant keeps its text layer, so
 * only operations that leave the page's geometry alone apply, to the raster
 * alone. Each other profile is a picture, its PDF holding only that raster.
 * `always` operations are always applied; each of `maybe` is with probability 0.6.
 */
const PROFILE_OPS: Record<
  Profile,
  { always: OpName[]; maybe: OpName[]; rotation: number; textLayer: boolean }
> = {
  'born-digital': { always: ['jpeg'], maybe: ['blur'], rotation: 0, textLayer: true },
  scan: {
    always: ['rotate', 'speckle', 'jpeg'],
    maybe: ['crop', 'twoUp', 'blur'],
    rotation: 0.2,
    textLayer: false,
  },
  photo: {
    always: ['rotate', 'perspective', 'lowLight', 'jpeg'],
    maybe: ['shadow', 'blur', 'crop'],
    rotation: 1,
    textLayer: false,
  },
  screen: {
    always: ['rotate', 'perspective', 'moire', 'blur', 'jpeg'],
    maybe: ['lowLight', 'crop'],
    rotation: 0.4,
    textLayer: false,
  },
}

/** The variant of `doc` under `profile`; `companion` is the page a two-up shares. */
export function planVariant(doc: CorpusDoc, profile: Profile, companion: string): Variant {
  const seed = variantSeed(doc.id, profile)
  const next = rng(seed)
  const { always, maybe, rotation, textLayer } = PROFILE_OPS[profile]
  const chosen = new Set<OpName>(always)
  // Draw for every optional operation so one outcome never shifts another's parameters.
  for (const name of maybe) if (next() < 0.6) chosen.add(name)
  const ops = OP_ORDER.filter((name) => chosen.has(name)).map((name) =>
    BUILD[name](rng(variantSeed(`${doc.id}:${name}`, profile)), rotation, companion)
  )
  return { id: `${doc.id}.${profile}`, baseId: doc.id, profile, seed, textLayer, ops }
}

/** Every document under every profile, in the corpus's order. */
export function buildManifest(corpus: CorpusDoc[]): Manifest {
  const variants = corpus.flatMap((doc, index) => {
    const companion = corpus[(index + 1) % corpus.length].id
    return PROFILES.map((profile) => planVariant(doc, profile, companion))
  })
  return { seed: NOISE_SEED, variants }
}

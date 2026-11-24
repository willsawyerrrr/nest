import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { buildCorpus } from './corpus.ts'
import { buildManifest, NOISE_SEED, OP_ORDER, PROFILES } from './noise.ts'

const corpus = buildCorpus()
const manifest = buildManifest(corpus)

Deno.test('the manifest holds every document under every profile with unique ids', () => {
  assertEquals(manifest.seed, NOISE_SEED)
  assertEquals(manifest.variants.length, corpus.length * PROFILES.length)
  assertEquals(new Set(manifest.variants.map((v) => v.id)).size, manifest.variants.length)
  const ids = new Set(corpus.map((doc) => doc.id))
  for (const variant of manifest.variants) assert(ids.has(variant.baseId), variant.id)
})

Deno.test('the manifest is the same on every run and leaves the corpus untouched', () => {
  assertEquals(buildManifest(buildCorpus()), manifest)
  assertEquals(JSON.stringify(buildCorpus()), JSON.stringify(corpus))
  assertEquals(corpus.length, 17)
})

Deno.test('only born-digital variants keep a text layer', () => {
  for (const variant of manifest.variants) {
    assertEquals(variant.textLayer, variant.profile === 'born-digital', variant.id)
  }
})

Deno.test('operations are in pipeline order and within the documented ranges', () => {
  for (const variant of manifest.variants) {
    const order = variant.ops.map((o) => OP_ORDER.indexOf(o.op))
    assertEquals(order, [...order].sort((a, b) => a - b), variant.id)
    assertEquals(new Set(order).size, order.length, variant.id)
    for (const op of variant.ops) {
      if (op.op === 'jpeg') assert(op.quality >= 30 && op.quality <= 60, variant.id)
      if (op.op === 'rotate') assert(Math.abs(op.degrees) <= 15 && op.degrees !== 0, variant.id)
      if (op.op === 'twoUp') assertNotEquals(op.companion, variant.baseId)
      if (op.op === 'crop') {
        for (const edge of [op.left, op.top, op.right, op.bottom]) assert(edge > 0 && edge < 0.1)
      }
    }
  }
})

Deno.test('born-digital variants carry no geometric operation', () => {
  for (const variant of manifest.variants.filter((v) => v.profile === 'born-digital')) {
    for (const op of variant.ops) assert(op.op === 'jpeg' || op.op === 'blur', variant.id)
  }
})

Deno.test('every operation appears somewhere in the manifest', () => {
  const seen = new Set(manifest.variants.flatMap((v) => v.ops.map((o) => o.op)))
  assertEquals([...seen].sort(), [...OP_ORDER].sort())
})

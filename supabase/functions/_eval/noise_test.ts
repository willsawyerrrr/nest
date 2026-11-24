import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { buildCorpus } from './corpus.ts'
import { buildManifest, loadDocs, NOISE_SEED, OP_ORDER, PROFILES, variantDocs } from './noise.ts'

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

Deno.test('a variant takes its source label and clusters under the source', () => {
  const docs = variantDocs(corpus, manifest)
  assertEquals(docs.length, manifest.variants.length)
  const byId = new Map(corpus.map((doc) => [doc.id, doc]))
  for (const [i, variant] of manifest.variants.entries()) {
    const doc = docs[i]
    const base = byId.get(variant.baseId)!
    assertEquals(doc.id, variant.id)
    assertEquals(doc.source, base.source ?? base.id)
    assertEquals(doc.kind, base.kind)
    assertEquals('label' in doc ? doc.label : null, 'label' in base ? base.label : null)
    assertEquals(doc.profile, variant.profile)
    assertEquals(doc.textLayer, variant.textLayer)
    const twoUp = variant.ops.find((op) => op.op === 'twoUp')
    assertEquals(doc.companion, twoUp?.companion)
  }
  assert(docs.some((doc) => doc.companion !== undefined))
})

Deno.test('a variant of a faulted document is not itself faulted', () => {
  const base = { ...corpus[0], fault: 'corrupt' as const }
  const [variant] = variantDocs([base], {
    seed: 1,
    variants: [{ ...manifest.variants[0], baseId: base.id }],
  })
  assertEquals(variant.fault, undefined)
})

Deno.test('loadDocs reads corpus, strata and manifest variants, and only what is there', async () => {
  const files: Record<string, string> = { '/d/corpus.json': JSON.stringify(corpus) }
  const read = (path: string) =>
    path in files ? Promise.resolve(files[path]) : Promise.reject(new Error('missing'))
  assertEquals((await loadDocs('/d', read)).docs.length, corpus.length)
  files['/d/strata.json'] = JSON.stringify([{
    ...corpus[0],
    id: 'strata-1',
    source: 'receipt:a:1',
  }])
  files['/d/manifest.json'] = JSON.stringify(manifest)
  const { docs, text } = await loadDocs('/d', read)
  assertEquals(docs.length, corpus.length + 1 + manifest.variants.length)
  assertEquals(docs[corpus.length].id, 'strata-1')
  assert(text.includes('strata-1'))
  files['/d/reskinned.json'] = JSON.stringify([{
    ...corpus[0],
    id: 'reskin-1.s0',
    source: 'reskin-1',
  }])
  const withReskin = await loadDocs('/d', read)
  assertEquals(withReskin.docs[corpus.length + 1].id, 'reskin-1.s0')
  assert(withReskin.text.includes('reskin-1.s0'))
})

import { assertEquals, assertRejects } from '@std/assert'
import type { UpWebhook } from './up.ts'
import { type RegisterDeps, registerWebhook, webhookBaseUrl, webhookUrl } from './upWebhook.ts'

const BASE = 'https://ref.supabase.co/functions/v1/up-webhook'
const URL_M1 = `${BASE}?m=m-1`

function webhook(id: string, url: string): UpWebhook {
  return { id, attributes: { url } }
}

/** Fakes whose calls land in `log`, over a token with `listed` webhooks. */
function fakes(listed: UpWebhook[], storedId: string | null = null) {
  const log: string[] = []
  const deps: RegisterDeps = {
    storedWebhookId: () => Promise.resolve(storedId),
    listWebhooks: () => Promise.resolve(listed),
    createWebhook: (url, description) => {
      log.push(`create ${url} ${description}`)
      return Promise.resolve({ id: 'wh-new', secretKey: 'secret' })
    },
    deleteWebhook: (id) => {
      log.push(`delete ${id}`)
      return Promise.resolve()
    },
    storeWebhook: (id, secret) => {
      log.push(`store ${id} ${secret}`)
      return Promise.resolve()
    },
  }
  return { deps, log }
}

Deno.test('webhookUrl carries the member id on the function URL', () => {
  assertEquals(webhookBaseUrl('https://ref.supabase.co/'), BASE)
  assertEquals(webhookUrl('https://ref.supabase.co', 'm-1'), URL_M1)
})

Deno.test('registerWebhook creates and stores a webhook when the member has none', async () => {
  const { deps, log } = fakes([webhook('other', 'https://elsewhere.test/hook')])
  assertEquals(await registerWebhook(URL_M1, deps), 'registered')
  assertEquals(log, [`create ${URL_M1} Nest`, 'store wh-new secret'])
})

Deno.test('registerWebhook keeps the stored webhook still registered at Up', async () => {
  const { deps, log } = fakes([webhook('wh-1', URL_M1)], 'wh-1')
  assertEquals(await registerWebhook(URL_M1, deps), 'existing')
  assertEquals(log, [])
})

Deno.test('registerWebhook replaces a Nest webhook whose secret is not stored', async () => {
  const { deps, log } = fakes([webhook('wh-orphan', URL_M1)])
  assertEquals(await registerWebhook(URL_M1, deps), 'registered')
  assertEquals(log, ['delete wh-orphan', `create ${URL_M1} Nest`, 'store wh-new secret'])
})

Deno.test('registerWebhook replaces a stored webhook Up no longer has', async () => {
  const { deps, log } = fakes([], 'wh-gone')
  assertEquals(await registerWebhook(URL_M1, deps), 'registered')
  assertEquals(log, [`create ${URL_M1} Nest`, 'store wh-new secret'])
})

Deno.test('registerWebhook deletes stray Nest webhooks beside the kept one', async () => {
  const { deps, log } = fakes(
    [webhook('wh-1', URL_M1), webhook('wh-stray', `${BASE}?m=old-member`)],
    'wh-1',
  )
  assertEquals(await registerWebhook(URL_M1, deps), 'existing')
  assertEquals(log, ['delete wh-stray'])
})

Deno.test('registerWebhook creates nothing when ten foreign webhooks fill the cap', async () => {
  const foreign = Array.from({ length: 10 }, (_, i) => webhook(`f-${i}`, `https://x.test/${i}`))
  const { deps, log } = fakes(foreign)
  assertEquals(await registerWebhook(URL_M1, deps), 'cap_reached')
  assertEquals(log, [])
})

Deno.test('registerWebhook frees a cap slot held by its own orphan', async () => {
  const foreign = Array.from({ length: 9 }, (_, i) => webhook(`f-${i}`, `https://x.test/${i}`))
  const { deps, log } = fakes([...foreign, webhook('wh-orphan', URL_M1)])
  assertEquals(await registerWebhook(URL_M1, deps), 'registered')
  assertEquals(log, ['delete wh-orphan', `create ${URL_M1} Nest`, 'store wh-new secret'])
})

Deno.test('registerWebhook deletes a created webhook whose store fails', async () => {
  const { deps, log } = fakes([])
  deps.storeWebhook = () => Promise.reject(new Error('vault down'))
  await assertRejects(() => registerWebhook(URL_M1, deps), Error, 'vault down')
  assertEquals(log, [`create ${URL_M1} Nest`, 'delete wh-new'])
})

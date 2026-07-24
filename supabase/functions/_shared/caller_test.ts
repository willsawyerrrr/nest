import { assertEquals } from '@std/assert'
import { type SupabaseClient } from '@supabase/supabase-js'
import { resolveMemberWithAdmin } from './caller.ts'

const request = new Request('https://x', { method: 'POST' })

Deno.test('resolveMemberWithAdmin resolves a member and captures its admin client', async () => {
  const admin = { marker: 'admin' } as unknown as SupabaseClient
  const resolution = resolveMemberWithAdmin(
    request,
    () => Promise.resolve({ caller: { admin, memberId: 'm-1' } }),
  )

  assertEquals(await resolution.resolveMember(), { memberId: 'm-1' })
  assertEquals(resolution.admin(), admin)
})

Deno.test('resolveMemberWithAdmin surfaces a resolution error', async () => {
  const resolution = resolveMemberWithAdmin(
    request,
    () => Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
  )

  assertEquals(await resolution.resolveMember(), {
    error: { status: 401, message: 'Invalid authorization' },
  })
})

Deno.test('resolveMemberWithAdmin passes the request to the resolver', async () => {
  let seen: Request | null = null
  const resolution = resolveMemberWithAdmin(request, (req) => {
    seen = req
    return Promise.resolve({ caller: { admin: {} as SupabaseClient, memberId: 'm-1' } })
  })

  await resolution.resolveMember()
  assertEquals(seen, request)
})

import { assertEquals, assertRejects } from '@std/assert'
import { type SupabaseClient } from '@supabase/supabase-js'
import { hashCalendarToken, resolveCalendarFeed } from './calendarFeed.ts'

// Cross-checked against Postgres: `select encode(sha256(convert_to(
// 'calendar-feed-test-token', 'UTF8')), 'hex')` returns the same digest, which
// is what proves `hashCalendarToken` looks up the row `create_calendar_feed_token`
// wrote.
Deno.test('hashCalendarToken matches the Postgres sha256(convert_to(token, UTF8)) hex digest', async () => {
  assertEquals(
    await hashCalendarToken('calendar-feed-test-token'),
    '610fb506c8bd23d23f8eefec90a95d6e2980ca0887a098467334d4f295d85efa',
  )
})

Deno.test('hashCalendarToken is deterministic, 64 hex chars, and input-sensitive', async () => {
  const first = await hashCalendarToken('token-a')
  assertEquals(first, await hashCalendarToken('token-a'))
  assertEquals(first.length, 64)
  assertEquals(first === (await hashCalendarToken('token-b')), false)
})

/** A minimal fake of the `.from().select().eq().maybeSingle()` chain the resolver uses. */
function fakeAdmin(
  result: { data: unknown; error: unknown },
  onQuery?: () => void,
): SupabaseClient {
  return {
    from: () => {
      onQuery?.()
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

Deno.test('resolveCalendarFeed resolves a matching token to its household', async () => {
  const admin = fakeAdmin({ data: { household_id: 'h-1' }, error: null })
  assertEquals(await resolveCalendarFeed(admin, 'calendar-feed-test-token'), { householdId: 'h-1' })
})

Deno.test('resolveCalendarFeed returns null for an unknown token', async () => {
  const admin = fakeAdmin({ data: null, error: null })
  assertEquals(await resolveCalendarFeed(admin, 'nope'), null)
})

Deno.test('resolveCalendarFeed returns null for a blank token without querying', async () => {
  let queried = false
  const admin = fakeAdmin({ data: { household_id: 'h-1' }, error: null }, () => {
    queried = true
  })
  assertEquals(await resolveCalendarFeed(admin, '   '), null)
  assertEquals(queried, false)
})

Deno.test('resolveCalendarFeed throws on a database error', async () => {
  const admin = fakeAdmin({ data: null, error: { message: 'connection reset' } })
  await assertRejects(() => resolveCalendarFeed(admin, 'calendar-feed-test-token'), Error)
})

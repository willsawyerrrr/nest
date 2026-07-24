import { assert, assertEquals } from '@std/assert'
import { handlePreflight, json, requirePost } from './http.ts'

Deno.test('requirePost lets a POST through', () => {
  assertEquals(requirePost(new Request('https://x', { method: 'POST' })), null)
})

Deno.test('requirePost rejects a GET with a 405 CORS JSON response', async () => {
  const response = requirePost(new Request('https://x', { method: 'GET' }))
  assert(response)
  assertEquals(response.status, 405)
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*')
  assertEquals(await response.json(), { error: 'Method not allowed' })
})

Deno.test('requirePost rejects other non-POST methods', () => {
  for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const response = requirePost(new Request('https://x', { method }))
    assert(response)
    assertEquals(response.status, 405)
  }
})

Deno.test('handlePreflight answers OPTIONS and passes anything else through', () => {
  assertEquals(handlePreflight(new Request('https://x', { method: 'OPTIONS' }))?.status, 200)
  assertEquals(handlePreflight(new Request('https://x', { method: 'POST' })), null)
})

Deno.test('json carries CORS and content-type headers', () => {
  const response = json({ ok: true }, 201)
  assertEquals(response.status, 201)
  assertEquals(response.headers.get('Content-Type'), 'application/json')
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*')
})

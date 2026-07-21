/**
 * Shared HTTP helpers for the browser-invoked edge functions. Each answers the
 * CORS preflight and echoes `corsHeaders` on every response, so these collapse
 * the boilerplate that would otherwise be copied per function.
 */

import { corsHeaders } from './cors.ts'

/** Build a CORS-enabled JSON response with the given body and status. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Answer the CORS preflight: a bare `OPTIONS` response carrying `corsHeaders`
 * when the request is a preflight, else `null` so the caller continues.
 */
export function handlePreflight(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

/**
 * Guard a POST-only endpoint: a 405 JSON response when the method is not
 * `POST`, else `null` so the caller continues.
 */
export function requirePost(request: Request): Response | null {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  return null
}

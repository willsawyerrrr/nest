/**
 * CORS headers for browser-invoked edge functions. The PWA calls these from a
 * different origin (Vercel) than the functions (Supabase), so each must answer
 * the preflight `OPTIONS` and echo these headers on every response.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

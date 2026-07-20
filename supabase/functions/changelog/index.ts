/**
 * Serves the in-app "What's new" changelog. JWT-verified (the default), so only
 * signed-in users can call it. Reads user-facing changes from GitHub for the
 * private `willsawyerrrr/nest` repo — open PRs as "in progress", merged-commit
 * subjects on `main` as "implemented" — using a token held as a function secret
 * (`GITHUB_CHANGELOG_TOKEN`). The token is never returned to the client, and the
 * function degrades to `configured: false` when the secret is unset.
 */

import { corsHeaders } from '../_shared/cors.ts'
import { runChangelog } from './changelog.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const result = await runChangelog(Deno.env.get('GITHUB_CHANGELOG_TOKEN'))
  return json(result.body, result.status)
})

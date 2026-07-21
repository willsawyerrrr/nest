/**
 * Serves the in-app "What's new" changelog. JWT-verified (the default), so only
 * signed-in users can call it. Reads user-facing changes from GitHub for the
 * private `willsawyerrrr/nest` repo — open PRs as "in progress", merged-commit
 * subjects on `main` as "implemented" — using a token held as a function secret
 * (`GITHUB_CHANGELOG_TOKEN`). The token is never returned to the client, and the
 * function degrades to `configured: false` when the secret is unset.
 */

import { handlePreflight, json } from '../_shared/http.ts'
import { runChangelog } from './changelog.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight

  const result = await runChangelog(Deno.env.get('GITHUB_CHANGELOG_TOKEN'))
  return json(result.body, result.status)
})

/**
 * Serves the in-app "What's new" changelog. JWT-verified (the default), so only
 * signed-in users can call it. Reads user-facing changes from GitHub for the
 * private `willsawyerrrr/nest` repo — open PRs as "in progress", merged-commit
 * subjects on `main` as "implemented" — using a token held as a function secret
 * (`GITHUB_CHANGELOG_TOKEN`). The token is never returned to the client, and the
 * function degrades to `configured: false` when the secret is unset.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { runChangelog } from './changelog.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // The client sends its build's commit SHA so entries newer than the running
  // build are cut; the body is read defensively so a missing/malformed one is fine.
  const body = (await request.json().catch(() => ({}))) as { sha?: unknown }
  const buildSha = typeof body.sha === 'string' ? body.sha : undefined

  const result = await runChangelog(Deno.env.get('GITHUB_CHANGELOG_TOKEN'), buildSha)
  return json(result.body, result.status)
})

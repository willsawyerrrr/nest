import { assertEquals } from '@std/assert'
import {
  type ChangelogResult,
  parseChangelogSubject,
  runChangelog,
  splitCommitsAtSha,
} from './changelog.ts'

Deno.test('parseChangelogSubject keeps feat/fix/perf and parses the scope', () => {
  assertEquals(parseChangelogSubject('feat(budget): Add every-N-weeks lines'), {
    type: 'feat',
    scope: 'budget',
    description: 'Add every-N-weeks lines',
  })
  assertEquals(parseChangelogSubject('fix: Correct LITO taper'), {
    type: 'fix',
    scope: null,
    description: 'Correct LITO taper',
  })
  assertEquals(parseChangelogSubject('perf(tax): Cache the config lookup'), {
    type: 'perf',
    scope: 'tax',
    description: 'Cache the config lookup',
  })
})

Deno.test('parseChangelogSubject excludes non-user-facing types', () => {
  assertEquals(parseChangelogSubject('chore: Rename application to Nest'), null)
  assertEquals(parseChangelogSubject('docs: Reconcile documentation'), null)
  assertEquals(parseChangelogSubject('ci(deploy): Shard the test job'), null)
  assertEquals(parseChangelogSubject('refactor: Extract a helper'), null)
})

Deno.test('parseChangelogSubject excludes ci-scoped entries but keeps other scopes', () => {
  assertEquals(parseChangelogSubject('perf(ci): Cache the Deno toolchain'), null)
  assertEquals(parseChangelogSubject('fix(ci): Pin the runner image'), null)
  assertEquals(parseChangelogSubject('feat(CI): Add a nightly job'), null)
  assertEquals(parseChangelogSubject('perf: Cache the config lookup'), {
    type: 'perf',
    scope: null,
    description: 'Cache the config lookup',
  })
  assertEquals(parseChangelogSubject('perf(pwa): Defer the chunk'), {
    type: 'perf',
    scope: 'pwa',
    description: 'Defer the chunk',
  })
  assertEquals(parseChangelogSubject('feat(splits): Confirm pay splits'), {
    type: 'feat',
    scope: 'splits',
    description: 'Confirm pay splits',
  })
})

Deno.test('parseChangelogSubject strips a trailing PR-number suffix', () => {
  assertEquals(parseChangelogSubject('feat(gifts): Add a purchase log (#117)'), {
    type: 'feat',
    scope: 'gifts',
    description: 'Add a purchase log',
  })
})

Deno.test('parseChangelogSubject lowercases the type and ignores unparseable subjects', () => {
  assertEquals(parseChangelogSubject('FEAT: Shout')?.type, 'feat')
  assertEquals(parseChangelogSubject('just a plain message'), null)
  assertEquals(parseChangelogSubject('feat: '), null)
})

/** Builds a JSON `Response` mimicking a GitHub REST reply. */
function githubResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500 })
}

const sampleCommits = [
  {
    sha: 'aaa111',
    commit: {
      message: 'feat(budget): Every-N-weeks budget lines (#117)\n\nBody text ignored.',
      committer: { date: '2026-07-10T00:00:00Z' },
    },
  },
  {
    sha: 'bbb222',
    commit: {
      message: 'chore: Rename application to Nest (#118)',
      committer: { date: '2026-07-09T00:00:00Z' },
    },
  },
  {
    sha: 'ccc333',
    commit: {
      message: 'fix: Correct a rounding error (#116)',
      committer: { date: '2026-07-08T00:00:00Z' },
    },
  },
  {
    sha: 'ddd444',
    commit: {
      message: 'perf(ci): Cache the Deno toolchain (#115)',
      committer: { date: '2026-07-07T00:00:00Z' },
    },
  },
]

const samplePulls = [
  { number: 120, title: 'feat(splits): Confirm pay splits', html_url: 'https://example/120' },
  { number: 121, title: 'docs: Update the roadmap', html_url: 'https://example/121' },
  { number: 122, title: 'fix(ci): Pin the runner image', html_url: 'https://example/122' },
]

Deno.test('runChangelog shapes commits and pulls, keeping only user-facing entries', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input.toString()
    calls.push(url)
    if (url.includes('/commits')) {
      return Promise.resolve(githubResponse(sampleCommits))
    }
    return Promise.resolve(githubResponse(samplePulls))
  }) as typeof fetch

  try {
    const result = await runChangelog('a-token')
    assertEquals(result.status, 200)
    const body = result.body as ChangelogResult
    assertEquals(body.configured, true)

    // No build SHA, so nothing is claimed as newer than the build.
    assertEquals(body.available, [])

    // chore and the ci-scoped perf are dropped; feat and fix are kept,
    // newest-first, PR suffix stripped.
    assertEquals(body.implemented, [
      {
        type: 'feat',
        scope: 'budget',
        description: 'Every-N-weeks budget lines',
        date: '2026-07-10T00:00:00Z',
        sha: 'aaa111',
      },
      {
        type: 'fix',
        scope: null,
        description: 'Correct a rounding error',
        date: '2026-07-08T00:00:00Z',
        sha: 'ccc333',
      },
    ])

    // docs and the ci-scoped fix are dropped; the feat PR is kept with its
    // number and url.
    assertEquals(body.inProgress, [
      {
        type: 'feat',
        scope: 'splits',
        description: 'Confirm pay splits',
        number: 120,
        url: 'https://example/120',
      },
    ])

    // Both GitHub endpoints are hit with the authenticated base.
    assertEquals(calls.some((url) => url.includes('/commits?sha=main&per_page=100')), true)
    assertEquals(calls.some((url) => url.includes('/pulls?state=open&per_page=100')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('runChangelog returns configured:false with empty lists when the token is unset', async () => {
  const result = await runChangelog(undefined)
  assertEquals(result, {
    status: 200,
    body: { configured: false, available: [], implemented: [], inProgress: [] },
  })
})

Deno.test('splitCommitsAtSha splits into commits newer than the build and that commit and older', () => {
  // The build is at ccc333 (the fix), so the newer feat (aaa111) and chore
  // (bbb222) are the newer half and ccc333 onward is the current half.
  const { newer, current } = splitCommitsAtSha(sampleCommits, 'ccc333')
  assertEquals(
    newer.map((commit) => commit.sha),
    ['aaa111', 'bbb222'],
  )
  assertEquals(
    current.map((commit) => commit.sha),
    ['ccc333', 'ddd444'],
  )
})

Deno.test('splitCommitsAtSha fails open when the build SHA is not in the list', () => {
  assertEquals(splitCommitsAtSha(sampleCommits, 'zzz999'), {
    newer: [],
    current: sampleCommits,
  })
})

Deno.test('splitCommitsAtSha claims nothing newer when no build SHA is given', () => {
  assertEquals(splitCommitsAtSha(sampleCommits, undefined), { newer: [], current: sampleCommits })
  assertEquals(splitCommitsAtSha(sampleCommits, ''), { newer: [], current: sampleCommits })
})

Deno.test('splitCommitsAtSha matches a short SHA prefix', () => {
  const { newer, current } = splitCommitsAtSha(sampleCommits, 'ccc')
  assertEquals(
    newer.map((commit) => commit.sha),
    ['aaa111', 'bbb222'],
  )
  assertEquals(
    current.map((commit) => commit.sha),
    ['ccc333', 'ddd444'],
  )
})

Deno.test('runChangelog reports newer entries as available and older as implemented', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input.toString()
    if (url.includes('/commits')) {
      return Promise.resolve(githubResponse(sampleCommits))
    }
    return Promise.resolve(githubResponse(samplePulls))
  }) as typeof fetch

  try {
    // Build is at ccc333: the newer feat (aaa111) is available (chore bbb222 is
    // dropped as non-user-facing) and only the fix (ccc333) is implemented — no
    // sha appears in both lists.
    const result = await runChangelog('a-token', 'ccc333')
    const body = result.body as ChangelogResult
    assertEquals(
      body.available.map((entry) => entry.sha),
      ['aaa111'],
    )
    assertEquals(
      body.implemented.map((entry) => entry.sha),
      ['ccc333'],
    )
    const overlap = body.available.some((a) => body.implemented.some((i) => i.sha === a.sha))
    assertEquals(overlap, false)
    // In-progress (open PRs) is untouched by the split.
    assertEquals(body.inProgress.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('runChangelog claims nothing available for an unknown build SHA', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input.toString()
    if (url.includes('/commits')) {
      return Promise.resolve(githubResponse(sampleCommits))
    }
    return Promise.resolve(githubResponse(samplePulls))
  }) as typeof fetch

  try {
    const result = await runChangelog('a-token', 'zzz999')
    const body = result.body as ChangelogResult
    assertEquals(body.available, [])
    // The full parsed list is implemented (feat + fix; chore and ci-scoped dropped).
    assertEquals(
      body.implemented.map((entry) => entry.sha),
      ['aaa111', 'ccc333'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('runChangelog surfaces a GitHub failure as a 502 error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch =
    (() => Promise.resolve(githubResponse({ message: 'Bad credentials' }, false))) as typeof fetch

  try {
    const result = await runChangelog('a-token')
    assertEquals(result.status, 502)
    assertEquals('error' in result.body, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

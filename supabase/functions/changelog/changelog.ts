/**
 * The changelog flow, with its HTTP injected so the parsing and filtering logic
 * is unit-tested without a network. `index.ts` wires the real GitHub fetch and
 * reads the token from the environment; here we only turn commits and pull
 * requests into user-facing entries.
 *
 * The repo `willsawyerrrr/nest` is private, so the token stays server-side: this
 * function proxies the GitHub REST API and returns only the shaped changelog.
 */

export const OWNER = 'willsawyerrrr'
export const REPO = 'nest'

const API_BASE = 'https://api.github.com'

/** Conventional Commit types that describe a user-facing change. */
const CHANGELOG_TYPES = new Set(['feat', 'fix', 'perf'])

export interface ParsedSubject {
  type: string
  scope: string | null
  description: string
}

export interface ImplementedEntry extends ParsedSubject {
  date: string
  sha: string
}

export interface InProgressEntry extends ParsedSubject {
  number: number
  url: string
}

export interface ChangelogResult {
  configured: boolean
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
}

export interface FlowResult {
  status: number
  body: ChangelogResult | { error: string }
}

interface GitHubCommit {
  sha: string
  commit: { message: string; committer: { date: string } }
}

interface GitHubPull {
  number: number
  title: string
  html_url: string
}

/**
 * Parses a Conventional Commit subject (`type(scope): description` or
 * `type: description`) into its parts, keeping only user-facing types
 * (feat/fix/perf) and returning `null` for everything else. The type is
 * lowercased, the scope is optional, and a trailing squash-merge PR-number
 * suffix (` (#123)`) is stripped from the description for display.
 *
 * A `ci`-scoped entry (case-insensitive) is dropped: those are CI/plumbing
 * changes, not user-facing.
 */
export function parseChangelogSubject(subject: string): ParsedSubject | null {
  const match = /^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/.exec(subject.trim())
  if (!match) {
    return null
  }
  const type = match[1].toLowerCase()
  if (!CHANGELOG_TYPES.has(type)) {
    return null
  }
  const scope = match[2]?.trim() ? match[2].trim() : null
  if (scope?.toLowerCase() === 'ci') {
    return null
  }
  const description = match[3]
    .trim()
    .replace(/\s*\(#\d+\)$/, '')
    .trim()
  if (!description) {
    return null
  }
  return { type, scope, description }
}

/**
 * Builds the changelog from GitHub. When the token is missing the function
 * degrades gracefully — a `200` marked `configured: false` with empty lists —
 * so the UI can show a "not configured yet" note rather than an error. A GitHub
 * failure surfaces as a `502` so the client can show an error state.
 */
export async function runChangelog(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<FlowResult> {
  if (!token) {
    return { status: 200, body: { configured: false, implemented: [], inProgress: [] } }
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nest-changelog',
  }
  const repo = `${API_BASE}/repos/${OWNER}/${REPO}`

  const [commitsRes, pullsRes] = await Promise.all([
    fetchImpl(`${repo}/commits?sha=main&per_page=100`, { headers }),
    fetchImpl(`${repo}/pulls?state=open&per_page=100`, { headers }),
  ])
  if (!commitsRes.ok || !pullsRes.ok) {
    return { status: 502, body: { error: 'Could not reach GitHub.' } }
  }

  const commits = (await commitsRes.json()) as GitHubCommit[]
  const pulls = (await pullsRes.json()) as GitHubPull[]

  // GitHub returns commits newest-first, so the implemented list is already ordered.
  const implemented: ImplementedEntry[] = []
  for (const commit of commits) {
    const parsed = parseChangelogSubject(commit.commit.message.split('\n')[0])
    if (parsed) {
      implemented.push({ ...parsed, date: commit.commit.committer.date, sha: commit.sha })
    }
  }

  const inProgress: InProgressEntry[] = []
  for (const pull of pulls) {
    const parsed = parseChangelogSubject(pull.title)
    if (parsed) {
      inProgress.push({ ...parsed, number: pull.number, url: pull.html_url })
    }
  }

  return { status: 200, body: { configured: true, implemented, inProgress } }
}

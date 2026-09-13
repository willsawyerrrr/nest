/**
 * Minimal typed client for the Redbark API (https://redbark.com), v2
 * (https://api.redbark.com/v2). Bearer-key auth, with a required
 * `Redbark-Version` header on every request. One platform-wide API key covers
 * every bank connection the household makes (see `REDBARK_API_KEY` in
 * docs/operations.md) — unlike Up's per-member personal access token, there is
 * no per-member credential here.
 */

export const REDBARK_API_BASE_URL = 'https://api.redbark.com/v2'
export const REDBARK_API_VERSION = '2026-10-01.wattle'

/** A monetary amount as Redbark returns it: an integer in the smallest currency unit. */
export interface RedbarkMoney {
  readonly amount: number
  readonly currency: string
}

/** A hosted Link Session: the redirect flow a member completes to connect a bank. */
export interface RedbarkLinkSession {
  readonly id: string
  readonly status: 'pending' | 'completed' | 'failed' | string
  readonly url: string
  /** The resulting connection id, set once `status` reaches `completed`. */
  readonly connection: string | null
  readonly failure_reason: string | null
}

/** A bank (or brokerage) connection Redbark holds on the household's behalf. */
export interface RedbarkConnection {
  readonly id: string
  readonly provider: string
  readonly category: 'banking' | 'brokerage'
  readonly institution: {
    readonly id: string
    readonly name: string
    readonly logo: string | null
  }
  readonly status: 'pending' | 'active' | 'expiring' | 'expired' | 'invalidated' | 'revoked'
  readonly account_count: number
}

/**
 * A bank or brokerage account under a connection. `type` is an open string —
 * Redbark documents no fixed enum of values.
 */
export interface RedbarkAccount {
  readonly id: string
  readonly connection: string
  readonly provider: string
  readonly category: 'banking' | 'brokerage'
  readonly name: string
  readonly type: string
  readonly account_number: string | null
  readonly currency: string
  readonly institution: {
    readonly id: string
    readonly name: string
    readonly logo: string | null
  }
  readonly status: string
}

/** An account's balance, fetched on demand rather than carried on the account. */
export interface RedbarkBalance {
  readonly account: string
  readonly current: RedbarkMoney
  readonly available: RedbarkMoney | null
  readonly currency: string
  readonly observed_at: string
  readonly freshness: string
}

/** A paginated list response. */
interface RedbarkList<T> {
  readonly object: 'list'
  readonly data: readonly T[]
  readonly next_page_url: string | null
}

/** Redbark's error envelope, `{ error: { type, code, message, ... } }`. */
interface RedbarkErrorBody {
  readonly error?: {
    readonly type?: string
    readonly code?: string
    readonly message?: string
  }
}

/** Best-effort extraction of the error `code` from a non-OK response body. */
function parseErrorCode(text: string): string | null {
  try {
    const body = JSON.parse(text) as RedbarkErrorBody
    return body.error?.code ?? null
  } catch {
    return null
  }
}

/**
 * A Redbark API error, carrying the HTTP status and the error envelope's
 * `code` (when the body parses as one) alongside a message in the same format
 * `up.ts`'s `UpClient` uses, so callers needing to branch on a specific error
 * (e.g. `connection_not_found`) can do so without re-parsing the message.
 */
export class RedbarkApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message)
    this.name = 'RedbarkApiError'
  }
}

/** A typed Redbark API client bound to the platform-wide API key. */
export class RedbarkClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = REDBARK_API_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Redbark-Version': REDBARK_API_VERSION,
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    })
    if (!response.ok) {
      const text = await response.text()
      const retrySuffix = response.status === 429
        ? ` (Retry-After: ${response.headers.get('Retry-After') ?? 'unknown'})`
        : ''
      throw new RedbarkApiError(
        response.status,
        parseErrorCode(text),
        `Redbark API ${response.status} for ${path}: ${text}${retrySuffix}`,
      )
    }
    return (await response.json()) as T
  }

  /** Walks every page of a list endpoint, following `next_page_url`, yielding each resource. */
  private async *paginate<T>(path: string): AsyncGenerator<T> {
    let next: string | null = path
    while (next) {
      const page: RedbarkList<T> = await this.request<RedbarkList<T>>(next)
      yield* page.data
      next = page.next_page_url
    }
  }

  /**
   * Checks the platform API key against a cheap authenticated call. Returns
   * true on a 200, false on any non-200 or network failure.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/connections?limit=1`, {
        headers: this.headers(),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Lists every account under a connection, walking `next_page_url` to completion. */
  async listAccounts(connectionId: string): Promise<RedbarkAccount[]> {
    const accounts: RedbarkAccount[] = []
    for await (
      const account of this.paginate<RedbarkAccount>(
        `/accounts?connection=${connectionId}&limit=100`,
      )
    ) {
      accounts.push(account)
    }
    return accounts
  }

  /** Fetches one account's current/available balance. */
  getBalance(accountId: string): Promise<RedbarkBalance> {
    return this.request<RedbarkBalance>(`/accounts/${accountId}/balance`)
  }

  /** Fetches one connection's status and institution details. */
  getConnection(connectionId: string): Promise<RedbarkConnection> {
    return this.request<RedbarkConnection>(`/connections/${connectionId}`)
  }

  /**
   * Revokes a connection. Throws `RedbarkApiError` on failure, including when
   * Redbark reports the connection as already gone (`code ===
   * 'connection_not_found'`) — the caller (`redbark-disconnect`) treats that
   * specific code as success rather than an error.
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.request<unknown>(`/connections/${connectionId}`, { method: 'DELETE' })
  }

  /**
   * Starts a hosted Link Session redirect flow: the caller redirects the
   * browser to the returned `url`, where the member completes Fiskil's
   * consent flow before being sent back to `returnUrl`.
   */
  createLinkSession(returnUrl: string): Promise<RedbarkLinkSession> {
    return this.request<RedbarkLinkSession>('/link_sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'fiskil', return_url: returnUrl }),
    })
  }

  /** Resolves a Link Session's current status; poll until it leaves `pending`. */
  getLinkSession(id: string): Promise<RedbarkLinkSession> {
    return this.request<RedbarkLinkSession>(`/link_sessions/${id}`)
  }
}

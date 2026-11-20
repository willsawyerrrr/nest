/**
 * Minimal typed client for the Up Bank API (https://developer.up.com.au/).
 * Bearer-token auth with a per-member personal access token. Responses follow
 * the JSON:API shape; only the fields the ledger needs are modelled here.
 */

export const UP_API_BASE_URL = 'https://api.up.com.au/api/v1'

/** A non-OK response from the Up API, carrying the HTTP status for callers that branch on it. */
export class UpApiError extends Error {
  constructor(readonly status: number, readonly path: string, body: string) {
    super(`Up API ${status} for ${path}: ${body}`)
    this.name = 'UpApiError'
  }
}

/**
 * True only for a token Up itself has rejected (401 Unauthorized or 403
 * Forbidden) — revoked or expired. A transient 5xx or a network failure is not
 * an auth error: it says nothing about whether the token is still good.
 */
export function isUpAuthError(error: unknown): boolean {
  return error instanceof UpApiError && (error.status === 401 || error.status === 403)
}

/** A monetary value as returned by Up. `valueInBaseUnits` is integer cents. */
export interface UpMoney {
  readonly currencyCode: string
  readonly value: string
  readonly valueInBaseUnits: number
}

/** An Up account resource (subset of attributes). */
export interface UpAccount {
  readonly id: string
  readonly attributes: {
    readonly displayName: string
    readonly accountType: 'SAVER' | 'TRANSACTIONAL' | 'HOME_LOAN'
    readonly ownershipType: 'INDIVIDUAL' | 'JOINT'
    readonly balance: UpMoney
    readonly createdAt: string
  }
}

/** A to-one JSON:API relationship naming another resource by id, or nothing. */
interface UpRelationship {
  readonly data: { readonly id: string } | null
}

/** An Up transaction resource (subset of attributes and relationships). */
export interface UpTransaction {
  readonly id: string
  readonly attributes: {
    readonly status: 'HELD' | 'SETTLED'
    readonly description: string
    /** The sender's message on a transfer or Pay Anyone payment. */
    readonly message: string | null
    /** False for a transaction Up does not let its owner categorise (e.g. a transfer). */
    readonly isCategorizable: boolean
    readonly amount: UpMoney
    readonly createdAt: string
    /** Null while the transaction is `HELD`. */
    readonly settledAt: string | null
    /** Up's description of the payment type (e.g. `Purchase`, `Transfer`), null when absent. */
    readonly transactionType: string | null
    /** The `up://` link opening the transaction in the Up app. */
    readonly deepLinkURL: string
    /** The owner's note on the transaction in the Up app. */
    readonly note: { readonly text: string } | null
    /** The cardholder who made the transaction, which tells 2Up partners apart. */
    readonly performingCustomer: { readonly displayName: string } | null
  }
  readonly relationships: {
    readonly account: { readonly data: { readonly id: string } }
    /** The child category; null when uncategorised. */
    readonly category: UpRelationship
    /** The child category's parent; null when uncategorised. */
    readonly parentCategory: UpRelationship
    /** The owner's other account the money moved to or from; null unless a transfer. */
    readonly transferAccount: UpRelationship
  }
}

/** Filters narrowing a transaction listing to the slice the ledger wants. */
export interface ListTransactionsOptions {
  /** Only transactions created at or after this instant (`filter[since]`). */
  readonly since?: Date
  /** Only transactions in this Up category, e.g. `gifts-and-charity`. */
  readonly category?: string
}

/** Retries of one request after a `429` before it fails. */
const MAX_RATE_LIMIT_RETRIES = 3

/** The longest wait honoured between `429` retries, so a run stays within its time limit. */
const MAX_RATE_LIMIT_WAIT_MS = 30_000

/**
 * How long to wait before retrying a `429`: Up's `Retry-After` seconds when it
 * sends them, else an exponential backoff from one second, capped at
 * {@link MAX_RATE_LIMIT_WAIT_MS}.
 */
export function rateLimitWaitMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('Retry-After'))
  const wait = Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : 1000 * 2 ** attempt
  return Math.min(wait, MAX_RATE_LIMIT_WAIT_MS)
}

/** A paginated JSON:API list response. */
interface UpList<T> {
  readonly data: readonly T[]
  readonly links: { readonly next: string | null }
}

/** A typed Up API client bound to a single member's access token. */
export class UpClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = UP_API_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /**
   * GETs `path`, throwing an {@link UpApiError} on a non-OK response. A `429`
   * is retried up to {@link MAX_RATE_LIMIT_RETRIES} times after the wait
   * {@link rateLimitWaitMs} names, and throws once those are spent.
   */
  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    for (let attempt = 0;; attempt++) {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await response.body?.cancel()
        await this.sleep(rateLimitWaitMs(response, attempt))
        continue
      }
      if (!response.ok) {
        throw new UpApiError(response.status, path, await response.text())
      }
      return (await response.json()) as T
    }
  }

  /** Walks every page of a list endpoint, yielding each resource. */
  private async *paginate<T>(path: string): AsyncGenerator<T> {
    let next: string | null = path
    while (next) {
      const page: UpList<T> = await this.get<UpList<T>>(next)
      yield* page.data
      next = page.links.next
    }
  }

  /**
   * Checks the token against Up's authenticated ping endpoint. Returns true on
   * a 200 (the token is valid), false on any non-200 or network failure.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/util/ping`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Lists all accounts for the token's owner. */
  async listAccounts(): Promise<UpAccount[]> {
    const accounts: UpAccount[] = []
    for await (const account of this.paginate<UpAccount>('/accounts?page[size]=100')) {
      accounts.push(account)
    }
    return accounts
  }

  /** Reads one transaction, or null when Up has no transaction by that id (a `404`). */
  async getTransaction(id: string): Promise<UpTransaction | null> {
    try {
      const { data } = await this.get<{ data: UpTransaction }>(
        `/transactions/${encodeURIComponent(id)}`,
      )
      return data
    } catch (error) {
      if (error instanceof UpApiError && error.status === 404) return null
      throw error
    }
  }

  /**
   * Lists one account's transactions created at or after `since`, newest first,
   * walking every page.
   */
  async listAccountTransactions(accountId: string, since: Date): Promise<UpTransaction[]> {
    const query = new URLSearchParams({
      'page[size]': '100',
      'filter[since]': since.toISOString(),
    })
    const transactions: UpTransaction[] = []
    for await (
      const tx of this.paginate<UpTransaction>(
        `/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`,
      )
    ) {
      transactions.push(tx)
    }
    return transactions
  }

  /**
   * Lists transactions for the token's owner, newest first, walking every page.
   * `since` bounds the listing by `createdAt` and `category` narrows it to one
   * Up child category; each transaction carries its own `category` relationship,
   * so no per-transaction fetch is needed to read it back.
   */
  async listTransactions(options: ListTransactionsOptions = {}): Promise<UpTransaction[]> {
    const query = new URLSearchParams({ 'page[size]': '100' })
    if (options.since) query.set('filter[since]', options.since.toISOString())
    if (options.category) query.set('filter[category]', options.category)
    const transactions: UpTransaction[] = []
    for await (const tx of this.paginate<UpTransaction>(`/transactions?${query.toString()}`)) {
      transactions.push(tx)
    }
    return transactions
  }
}

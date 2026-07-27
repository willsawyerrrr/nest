/**
 * Minimal typed client for the Up Bank API (https://developer.up.com.au/).
 * Bearer-token auth with a per-member personal access token. Responses follow
 * the JSON:API shape; only the fields the ledger needs are modelled here.
 */

export const UP_API_BASE_URL = 'https://api.up.com.au/api/v1'

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

/** An Up transaction resource (subset of attributes and relationships). */
export interface UpTransaction {
  readonly id: string
  readonly attributes: {
    readonly status: 'HELD' | 'SETTLED'
    readonly description: string
    readonly amount: UpMoney
    readonly createdAt: string
    /** Null while the transaction is `HELD`. */
    readonly settledAt: string | null
  }
  readonly relationships: {
    readonly account: { readonly data: { readonly id: string } }
    /** The child category, carried on list responses; null when uncategorised. */
    readonly category: { readonly data: { readonly id: string } | null }
  }
}

/** Filters narrowing a transaction listing to the slice the ledger wants. */
export interface ListTransactionsOptions {
  /** Only transactions created at or after this instant (`filter[since]`). */
  readonly since?: Date
  /** Only transactions in this Up category, e.g. `gifts-and-charity`. */
  readonly category?: string
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
  ) {}

  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!response.ok) {
      throw new Error(`Up API ${response.status} for ${path}: ${await response.text()}`)
    }
    return (await response.json()) as T
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

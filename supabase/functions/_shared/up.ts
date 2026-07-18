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
    readonly message: string | null
    readonly amount: UpMoney
    readonly createdAt: string
    readonly settledAt: string | null
  }
  readonly relationships: {
    readonly account: { readonly data: { readonly id: string } }
    readonly category: { readonly data: { readonly id: string } | null }
  }
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
  ) {}

  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const response = await fetch(url, {
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

  /** Lists all accounts for the token's owner. */
  async listAccounts(): Promise<UpAccount[]> {
    const accounts: UpAccount[] = []
    for await (const account of this.paginate<UpAccount>('/accounts?page[size]=100')) {
      accounts.push(account)
    }
    return accounts
  }

  /**
   * Lists transactions for the token's owner, newest first. When `since` is
   * given (ISO 8601), only transactions created at or after it are returned.
   */
  async listTransactions(since?: string): Promise<UpTransaction[]> {
    const query = new URLSearchParams({ 'page[size]': '100' })
    if (since) query.set('filter[since]', since)
    const transactions: UpTransaction[] = []
    for await (const tx of this.paginate<UpTransaction>(`/transactions?${query.toString()}`)) {
      transactions.push(tx)
    }
    return transactions
  }
}

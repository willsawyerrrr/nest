import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { bearerToken, verifyToken, type AuthConfig, type VerifiedToken } from './auth.ts'
import type { NestContext } from './context.ts'
import { createServer } from './server.ts'
import { memberContext } from './session.ts'

export interface HttpConfig extends AuthConfig {
  /** The public origin the server is served from, e.g. `https://mcp.nest.willsawyerrrr.dev`. */
  origin: string
}

export interface HttpDeps {
  verify?: (token: string) => Promise<VerifiedToken | null>
  context?: (verified: VerifiedToken) => Promise<NestContext>
}

const METADATA_PATH = '/.well-known/oauth-protected-resource'

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * Handles requests for the remote MCP server. It is an OAuth resource server:
 * Supabase Auth issues the tokens, and each request is served statelessly as
 * the member its bearer token verifies to, under row-level security.
 */
export function createHandler(
  config: HttpConfig,
  deps: HttpDeps = {},
): (request: Request) => Promise<Response> {
  const origin = config.origin.replace(/\/$/, '')
  const metadataUrl = `${origin}${METADATA_PATH}`
  const verify = deps.verify ?? ((token: string) => verifyToken(config, token))
  const context =
    deps.context ??
    ((verified: VerifiedToken) =>
      memberContext(verified.supabase, verified.userId, async () => {
        throw new Error('Local files are not available over HTTP.')
      }))

  const unauthorized = (error?: 'invalid_token') =>
    json({ error: error ?? 'unauthorized' }, 401, {
      'www-authenticate': `Bearer${error ? ` error="${error}",` : ''} resource_metadata="${metadataUrl}"`,
    })

  return async (request) => {
    const { pathname } = new URL(request.url)

    if (pathname === METADATA_PATH || pathname === `${METADATA_PATH}/mcp`) {
      return json(
        {
          resource: `${origin}/mcp`,
          authorization_servers: [`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`],
          bearer_methods_supported: ['header'],
          resource_name: 'Nest',
        },
        200,
        { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' },
      )
    }
    if (pathname !== '/mcp') return json({ error: 'not_found' }, 404)

    const token = bearerToken(request.headers.get('authorization'))
    if (token === null) return unauthorized()
    const verified = await verify(token)
    if (verified === null) return unauthorized('invalid_token')

    let ctx: NestContext
    try {
      ctx = await context(verified)
    } catch {
      return json({ error: 'forbidden', error_description: 'Not a household member.' }, 403)
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await createServer(ctx, 'http').connect(transport)
    return transport.handleRequest(request)
  }
}

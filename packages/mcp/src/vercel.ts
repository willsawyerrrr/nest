import { createHandler } from './http.ts'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set.`)
  return value
}

const handler = createHandler({
  supabaseUrl: required('SUPABASE_URL'),
  anonKey: required('SUPABASE_ANON_KEY'),
  origin: process.env.MCP_ORIGIN?.trim() || 'https://mcp.nest.willsawyerrrr.dev',
})

export default { fetch: handler }

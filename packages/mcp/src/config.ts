import { z } from 'zod'

const nonEmpty = z.string().trim().min(1)

const envSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: nonEmpty,
    NEST_REFRESH_TOKEN: nonEmpty.optional(),
    NEST_ACCESS_TOKEN: nonEmpty.optional(),
    NEST_SESSION_FILE: nonEmpty.optional(),
  })
  .refine((env) => env.NEST_REFRESH_TOKEN !== undefined || env.NEST_ACCESS_TOKEN !== undefined, {
    message: 'Set NEST_REFRESH_TOKEN (preferred) or NEST_ACCESS_TOKEN',
  })

export interface Config {
  supabaseUrl: string
  anonKey: string
  /** The signed-in member's refresh token, which keeps the session alive. */
  refreshToken: string | undefined
  /** A short-lived access token, used alone when no refresh token is given. */
  accessToken: string | undefined
  /** Where the rotating session is kept between runs. */
  sessionFile: string
}

/**
 * Reads the server's configuration from the environment. Only the project's
 * publishable anon key is accepted: the server acts as a signed-in household
 * member under row-level security and never holds a service-role credential.
 */
export function readConfig(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration. ${problems}`)
  }
  const value = parsed.data
  const configHome = env.XDG_CONFIG_HOME?.trim() || `${home}/.config`
  return {
    supabaseUrl: value.SUPABASE_URL,
    anonKey: value.SUPABASE_ANON_KEY,
    refreshToken: value.NEST_REFRESH_TOKEN,
    accessToken: value.NEST_ACCESS_TOKEN,
    sessionFile: value.NEST_SESSION_FILE ?? `${configHome}/nest-mcp/session.json`,
  }
}

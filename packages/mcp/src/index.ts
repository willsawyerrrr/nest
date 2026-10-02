#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readConfig } from './config.ts'
import { createServer } from './server.ts'
import { createContext } from './session.ts'

async function main(): Promise<void> {
  const config = readConfig(process.env, homedir())
  const ctx = await createContext(config, (path) => readFile(path))
  await createServer(ctx).connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  // stdout carries the protocol, so diagnostics go to stderr.
  console.error(error instanceof Error ? error.message : 'Nest MCP server failed to start.')
  process.exit(1)
})

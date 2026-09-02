#!/usr/bin/env node
// dsh-acp-zed: ACP (Agent Client Protocol) v1 stdio server for DeepSeek
// Harness. Zed spawns this process; while serving, stdout carries ONLY ndjson
// JSON-RPC frames — every diagnostic and help line rides stderr
// (docs/design.zh.md §4.3, §10).
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { boot, installFailLoud, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { runLogin, resolveAuthKey } from './auth.js'
import { runMcp } from './mcp-store.js'
import { runPlugin } from './plugins.js'
import { acpHome, overlayPath } from './config.js'

const NAME = 'dsh-acp-zed'
const USAGE = `usage: ${NAME} [--config path] [--list-models] [--help] [login|logout|mcp …|plugin …]

Boots the shipped dsh-base + dsh-acp-zed composition and serves ACP JSON-RPC
over stdio for Zed's Agent Panel. stdout carries ONLY JSON-RPC frames;
diagnostics ride stderr. Full surface: see docs/design.zh.md §9.`

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return existsSync(join(here, 'package.json')) ? here : join(here, '..')
}

/** The empty entries root the include loader mounts; patches layer on top. */
function rootEntriesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const dir of [here, join(here, '..')]) {
    if (existsSync(join(dir, 'boot.yml'))) return join(dir, 'boot.yml')
  }
  throw new Error(`${NAME}: boot.yml not found next to the binary`)
}

/** Our bundle patch file (patch ops over @deepseek-ai/dsh-base rows). */
function ownPatchPath(): string {
  const root = packageRoot()
  for (const p of [join(root, 'cordis.patch.yml'), join(dirname(fileURLToPath(import.meta.url)), '..', 'cordis.patch.yml')]) {
    if (existsSync(p)) return p
  }
  throw new Error(`${NAME}: cordis.patch.yml not found next to the binary`)
}

/** dsh-base bundle patch ops — the shared base rows (llm, session, tools…). */
function basePatchOps() {
  const require = createRequire(import.meta.url)
  const baseDir = dirname(require.resolve('@deepseek-ai/dsh-base/package.json'))
  const manifest = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared !== 'string') throw new Error(`${NAME}: @deepseek-ai/dsh-base declares no dsh.bundle.patch`)
  return loadOverlayPatches(NAME, join(baseDir, declared))
}

installFailLoud(NAME)

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
    'list-models': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    login: { type: 'boolean' },
    logout: { type: 'boolean' },
  },
  allowPositionals: true,
  strict: true,
})

if (values.help) {
  process.stderr.write(USAGE + '\n')
  process.exit(0)
}

const verb = values.login ? 'login' : values.logout ? 'logout' : positionals[0]
if (verb === 'login' || verb === 'logout') {
  process.exit(await runLogin(verb, process.stdin, process.stdout, process.stderr, acpHome()))
}
if (verb === 'mcp') process.exit(await runMcp(positionals.slice(1))) // TODO(M4): enroll/auth/list/remove
if (verb === 'plugin') process.exit(await runPlugin(positionals.slice(1))) // TODO(M4): managed overlay add/list/remove
if (positionals.length > 0) {
  process.stderr.write(USAGE + '\n')
  process.exit(2)
}

// Serve branch — stdout is the protocol transport from here on.
// Seed the provider key (env-first -> auth.env) BEFORE boot so !!js
// composition expressions and adapters resolve against the completed env.
const seededKey = await resolveAuthKey(process.env, acpHome())
if (seededKey) process.env.DEEPSEEK_API_KEY = seededKey

const ownOps = loadOverlayPatches(NAME, ownPatchPath())
const userOps = existsSync(overlayPath()) ? loadOverlayPatches(NAME, overlayPath()) : []
const userPatches = [...basePatchOps(), ...ownOps, ...userOps]

interface App {
  fiber?: { dispose(): Promise<unknown> }
  get<T = unknown>(service: string): T | undefined
}
let app: App | undefined
let disposed = false
// Client closed stdout early: never crash on ERR_STREAM_DESTROYED.
process.stdout.on('error', () => {
  try {
    process.exit(0)
  } catch {
    /* ignore */
  }
})
async function disposeOnce() {
  if (disposed) return
  disposed = true
  await app?.fiber?.dispose()
}
// stdin may already be EOF in piped/one-shot runs; track it so we exit after
// boot instead of tearing a boot in progress down.
let stdinEnded = false
process.stdin.on('end', () => {
  stdinEnded = true
})

app = (await boot(NAME, rootEntriesPath(), userPatches)) as App

if (stdinEnded) {
  await disposeOnce()
  process.exit(0)
}
// Lifecycle handlers attach only after boot (serve mode).
process.stdin.on('end', () => void disposeOnce().then(() => process.exit(0)))
process.on('SIGINT', () => void disposeOnce().then(() => process.exit(0)))
process.on('SIGTERM', () => void disposeOnce().then(() => process.exit(0)))
process.stdin.resume()

if (values['list-models']) {
  const llm = app?.get<{
    listProviders(): Promise<Array<{ id: string; name?: string }>>
    listModels(providerId: string): Promise<Array<{ id: string; name?: string }>>
  }>('llm')
  if (!llm) {
    process.stderr.write(`${NAME}: --list-models failed: composition mounted no llm service\n`)
    await disposeOnce()
    process.exit(1)
  }
  for (const provider of await llm.listProviders()) {
    process.stderr.write(`${provider.id}\t${provider.name ?? ''}\n`)
    for (const model of await llm.listModels(provider.id)) {
      process.stderr.write(`  ${model.id}\t${model.name ?? ''}\n`)
    }
  }
  await disposeOnce()
  process.exit(0)
}

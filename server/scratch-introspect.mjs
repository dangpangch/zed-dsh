// Scratch introspection: boot the real composition and print service surfaces.
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { boot, installFailLoud, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

installFailLoud('introspect')
const NAME = 'introspect'
function packageRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return here
}
function ownPatchPath() {
  const root = '/home/pang/ws/harness/zed-dsh/server'
  for (const p of [join(root, 'cordis.patch.yml'), join(root, 'cordis.patch.yml')]) {
    if (existsSync(p)) return p
  }
  throw new Error('no patch')
}
function basePatchOps() {
  const require = createRequire('/home/pang/ws/harness/zed-dsh/server/scratch-x.mjs')
  const baseDir = dirname(require.resolve('@deepseek-ai/dsh-base/package.json'))
  const manifest = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  return loadOverlayPatches(NAME, join(baseDir, declared))
}

const app = await boot(NAME, '/home/pang/ws/harness/zed-dsh/server/boot.yml', [
  ...basePatchOps(),
  ...loadOverlayPatches(NAME, ownPatchPath()),
])

const dump = (label, svc) => {
  const names = new Set()
  let o = svc
  while (o && o !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(o)) names.add(n)
    o = Object.getPrototypeOf(o)
  }
  console.log(`\n## ${label}:`, [...names].filter((n) => n !== 'constructor').join(' '))
}
try { dump('agents', app.get('agents')) } catch (e) { console.log('agents ERR', String(e)) }
for (const s of ['sessionPersistence', 'llm', 'commands', 'permissionPresets', 'sandboxPolicy', 'sessionProjections', 'userQuestions', 'subagents', 'attachments', 'agentDefaultModel', 'agentLoop', 'sessionQuery', 'approval']) {
  try {
    const svc = app.get(s)
    console.log(`\n## service ${s} present:`, svc !== undefined)
    if (svc !== undefined) dump(s, svc)
  } catch (e) { console.log(`## service ${s} ERR`, String(e)) }
}
// Enumerate ctx events offered by the agent/session layers for this bridge.
const ctx = app.get
// Print session-level service instance names too:
try {
  const agents = app.get('agents')
  console.log('\nagents keys sample:', Object.getOwnPropertyNames(agents).join(' '))
  console.log('agents.ctx event?', typeof agents)
} catch (e) { console.log('ERR', String(e)) }
await app?.fiber?.dispose?.()
process.exit(0)

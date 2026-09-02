#!/usr/bin/env node
// dsh-acp-zed archive builder.
//   node build-archive.mjs --manifest          (OFFLINE, ready) writes archive-manifest.json
//   node build-archive.mjs --platform <os-arch> --node <ver>   (M3) downloads the node dist,
//       installs the server deps for that platform, assembles the self-contained dir
//       (renamed node runtime + lib/ + cordis.yml + package.json), emits tar.gz/zip + sha256.
//
// The produced archive serves BOTH the ACP Registry distribution.binary and
// the legacy extension.toml targets (docs/design.zh.md §8). URL/sha256
// injection reads packaging/archive-manifest.json.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'packaging', 'out')
const MANIFEST = join(ROOT, 'packaging', 'archive-manifest.json')

export const VERSION = '0.0.0' // bumped with releases; injected below

// os-arch (registry/extension spelling) -> node dist naming
export const PLATFORMS = {
  'darwin-aarch64': { node: 'darwin-arm64', ext: 'tar.gz' },
  'darwin-x86_64': { node: 'darwin-x64', ext: 'tar.gz' },
  'linux-aarch64': { node: 'linux-arm64', ext: 'tar.gz' },
  'linux-x86_64': { node: 'linux-x64', ext: 'tar.gz' },
  'windows-aarch64': { node: 'win-arm64', ext: 'zip' },
  'windows-x86_64': { node: 'win-x64', ext: 'zip' },
}

export function nodeDistUrl(nodeVersion, node) {
  const ext = node.startsWith('win-') ? 'zip' : 'tar.gz'
  return `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${node}.${ext}`
}

export function releaseUrl(platform, ext) {
  return `https://github.com/OWNER/zed-dsh/releases/download/v${VERSION}/dsh-acp-zed-${platform}.${ext}`
}

async function writeManifest() {
  const platforms = Object.fromEntries(
    Object.entries(PLATFORMS).map(([key, { ext }]) => [
      key,
      { archive: releaseUrl(key, ext), sha256: null, nodeDist: null }, // filled by the M3 build
    ]),
  )
  const manifest = { version: VERSION, platforms }
  await mkdir(dirname(MANIFEST), { recursive: true })
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.error(`archive-manifest.json written (${Object.keys(platforms).length} platforms, v${VERSION})`)
}

const flag = process.argv[2]
if (flag === '--manifest') {
  await writeManifest()
} else if (flag === '--platform') {
  const platform = process.argv[3]
  const nodeVersion = process.argv[4] ?? '--node <ver>'
  console.error(`download/assemble lands in M3: ${platform} on ${nodeVersion} (see docs/design.zh.md §8)`)
  process.exit(1)
} else {
  console.error('usage: build-archive.mjs --manifest | --platform <os-arch> --node <ver>')
  process.exit(2)
}

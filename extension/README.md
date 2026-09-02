# Legacy Zed Agent Server Extension for DeepSeek Harness (compat appendix)

> ⚠️ Zed ≥ v0.221 deprecates Agent Server Extensions in favor of the ACP
> Registry. **Use the Registry or a Custom Agent on current Zed** — see
> `docs/zed-setup.zh.md`. This folder is kept only for Zed ≤ v0.22x.

What this folder is: a pure-manifest Zed extension (`extension.toml`) whose
`agent_servers.deepseek-harness` downloads a per-platform archive and runs
the ACP server inside it. It ships no code of its own.

The archive (`dsh-acp-zed-{os}-{arch}`) is produced by
`packaging/build-archive.mjs` (M3): a renamed Node runtime + `lib/` +
`cordis.yml`, entry `cmd = "dsh-acp-zed(.exe)"`, `args = ["lib/bin.js"]`.
`extension.toml` archive URLs / sha256 are placeholders until the release
pipeline injects them (`packaging/archive-manifest.json`).

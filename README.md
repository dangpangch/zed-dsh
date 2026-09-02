# zed-dsh — DeepSeek Harness agent for Zed

[简体中文](./README.zh.md)

Run a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent
inside Zed's Agent Panel (and other ACP clients) over the
[Agent Client Protocol](https://agentclientprotocol.com) v1 (stdio JSON-RPC):
streaming text & thinking, tool cards with structured diffs, per-session
model / thinking / write-permission selectors, session history, slash skills,
image prompts, MCP servers, and one-shot permission prompts.

**Status: M0 scaffold + M1 local done.**
M1: baseline locked (dsh rc.2), server installs/builds, CLI verbs pass
(`--help`, `login/logout` with mode-600 auth.env, `--list-models` boots the full
`dsh-base` + patch composition and prints the provider/model catalog). Remaining M1
item — a first ACP session in real Zed — lands with the interactive bridge in M2. See `docs/design.zh.md` for the full
design and `plan.md` for milestones M1–M4 (M1 = runnable Custom Agent).

## Installation (current Zed ≥ v0.221)

1. **ACP Registry (recommended)** — once published (M4): `zed: acp registry`
   → DeepSeek Harness.
2. **Custom Agent** — paste into Zed settings (see `examples/`):

```json
{
  "agent_servers": {
    "DeepSeek Harness": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "dsh-acp-zed"],
      "env": {}
    }
  }
}
```

3. Legacy Zed (≤ v0.22x): the `extension/` Agent Server Extension (deprecated
   upstream).

Full install + troubleshooting: `docs/zed-setup.zh.md`.

## Layout

```
docs/            design, protocol map, setup, acceptance
registry/        ACP Registry agent entry (agent.json + icon.svg)
extension/       legacy Zed Agent Server Extension (compat appendix)
server/          the ACP server npm package (dsh-acp-zed)
packaging/       self-contained archive builder + manifest
examples/        Zed settings snippets
```

Reference implementations (knowledge baseline only, never forked or depended
on): `cnctem/dsh-acp`, `@anht3889/dsh-acp-zed`, `svkozak/pi-acp`.

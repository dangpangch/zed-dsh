// MCP catalog verbs (dsh-acp-zed mcp add http|stdio|auth|list|remove).
// SCAFFOLD: interface only — implementation lands in M4 (design.zh.md §6.7,
// §9). Stdio servers mount into every session via the bridge; HTTP(OAuth)
// entries additionally run the browser dance through the shared catalog
// ($DSH_HOME/mcp) so the dsh web profile and this bridge share tokens.

export function runMcp(_args: string[]): Promise<number> {
  process.stderr.write('dsh-acp-zed mcp: not implemented yet (M4) — see docs/design.zh.md §6.7\n')
  return Promise.resolve(2)
}

// User plugin verbs (dsh-acp-zed plugin add|list|remove).
// SCAFFOLD: interface only — implementation lands in M4 (design.zh.md §9).
// Managed overlay blocks (BEGIN/END markers) over $DSH_HOME/acp-zed/overlay.cordis.yml
// plus a private npm workspace under $DSH_HOME/acp-zed/plugins.
export function runPlugin(_args: string[]): Promise<number> {
  process.stderr.write('dsh-acp-zed plugin: not implemented yet (M4) — see docs/design.zh.md §9\n')
  return Promise.resolve(2)
}

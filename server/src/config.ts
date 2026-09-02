// Path/config helpers for the acp-zed home under the harness home
// (default ~/.dsh/acp-zed; $DSH_HOME relocates the root). design.zh.md §4.2.
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

export function acpHome(): string {
  return dshHomePath('acp-zed') // TODO(M1): confirm overload for subpaths
}

export const settingsPath = (): string => join(acpHome(), 'settings.yaml')
export const credentialsPath = (): string => join(acpHome(), 'credentials.yaml')
export const overlayPath = (): string => join(acpHome(), 'overlay.cordis.yml')
export const sessionsPath = (): string => join(acpHome(), 'sessions')

// Terminal Auth verbs (login/logout) for the ACP Zed bridge.
// NOT the ACP stdio path: prompts/confirmations go to the caller's streams
// (their stdout is sanctioned). Key is never echoed, logged, or sent anywhere
// but the provider request (design.zh.md §9, §10).
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as readline from 'node:readline'

export const AUTH_ENV_VAR = 'DEEPSEEK_API_KEY'

export function authFilePath(homeDir: string): string {
  return join(homeDir, 'auth.env')
}

/** env-first -> persisted auth.env (mode 600). Returns undefined when unset. */
export async function resolveAuthKey(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): Promise<string | undefined> {
  const fromEnv = env[AUTH_ENV_VAR]?.trim()
  if (fromEnv) return fromEnv
  try {
    const text = await readFile(authFilePath(homeDir), 'utf8')
    const m = text.match(new RegExp(`^${AUTH_ENV_VAR}=(.*)$`, 'm'))
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

async function promptForKey(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): Promise<string> {
  stdout.write('API key: ')
  const terminal = stdin.isTTY === true
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal })
  if (terminal) {
    // Never echo the typed key back to the terminal.
    ;(rl as { _writeToOutput?: () => void })._writeToOutput = () => {}
  }
  const answer = await new Promise<string>((resolve) => {
    rl.question('', (a) => {
      rl.close()
      resolve(a.trim())
    })
  })
  if (terminal) stdout.write('\n')
  return answer
}

/** Run one auth verb; returns the process exit code (0 ok, 1 runtime, 2 usage). */
export async function runLogin(
  verb: string,
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  stderr: NodeJS.WriteStream,
  homeDir: string,
): Promise<number> {
  if (verb !== 'login' && verb !== 'logout') {
    stderr.write('usage: dsh-acp-zed (login|logout)\n')
    return 2
  }
  const file = authFilePath(homeDir)
  if (verb === 'logout') {
    await rm(file, { force: true })
    stdout.write('Logged out: removed ' + file + '\n')
    return 0
  }
  const envKey = process.env[AUTH_ENV_VAR]?.trim()
  const key = envKey || (await promptForKey(stdin, stdout))
  if (!key) {
    stderr.write('no API key provided\n')
    return 1
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${AUTH_ENV_VAR}=${key}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  stdout.write(`Saved API key to ${file} (mode 600).\n`)
  return 0
}

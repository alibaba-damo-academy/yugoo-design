/** User-owned projects belong in Documents; runtime state has separate owners. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { posix, win32 } from 'node:path'

interface DocumentsEnvironment {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  readConfig?: (path: string) => string
  windowsDocuments?: () => string
}

function windowsDocuments(env: NodeJS.ProcessEnv): string {
  const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1]
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('Windows SystemRoot is unavailable')
  const probe = mkdtempSync(join(tmpdir(), 'yugoo-documents-'))
  const result = join(probe, 'documents.txt')
  try {
    // Constrained PowerShell can deny the .NET API. Reading the registered user
    // folder with a normal cmdlet works there without changing execution policy.
    // A UTF-8 file avoids depending on the Windows console's current code page.
    execFileSync(win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; try { $folder = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify) } catch { $folder = Get-ItemPropertyValue -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -Name Personal }; Set-Content -LiteralPath $env:YUGOO_DOCUMENTS_PROBE_RESULT -Value $folder -NoNewline -Encoding UTF8",
    ], { env: { ...env, YUGOO_DOCUMENTS_PROBE_RESULT: result }, windowsHide: true, timeout: 10000, maxBuffer: 16384 })
    const variables = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]))
    const registered = readFileSync(result, 'utf8').replace(/^\uFEFF/u, '').trim()
    return registered.replace(/%([^%]+)%/gu, (_match, name: string) => {
      const value = variables.get(name.toLowerCase())
      if (value === undefined) throw new Error(`Unknown Windows folder variable: ${name}`)
      return value
    })
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

function xdgDocuments(text: string, home: string): string | undefined {
  // user-dirs.dirs uses shell assignments. Parse its bounded data grammar only;
  // never source it, expand arbitrary variables or execute command substitutions.
  const lines = text.split(/\r?\n/u).filter(line => /^\s*XDG_DOCUMENTS_DIR\s*=/u.test(line))
  if (lines.length !== 1) return undefined
  const match = /^\s*XDG_DOCUMENTS_DIR\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/u.exec(lines[0]!)
  if (!match) return undefined
  let value = match[1]!
  let prefix = ''
  if (/^\$(?:HOME|\{HOME\})(?:\/|$)/u.test(value)) {
    value = value.replace(/^\$(?:HOME|\{HOME\})/u, '')
    prefix = home
  }
  // Escaped dollars/backticks are literal filenames; unescaped ones are not data.
  let decoded = prefix
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (char === '$' || char === '`' || char === '\0') return undefined
    if (char === '\\') {
      const next = value[++i]
      if (!next || !['\\', '"', '$', '`'].includes(next)) return undefined
      decoded += next
    } else decoded += char
  }
  if (!posix.isAbsolute(decoded)) return undefined
  const normalized = posix.resolve(decoded)
  // XDG explicitly uses HOME to disable a special directory. Use our documented
  // Documents fallback rather than putting YuGoo directly in the home directory.
  return normalized === posix.resolve(home) ? undefined : normalized
}

/** Default for new projects, resolved on the platform running the host process.
 * Injectable OS reads keep redirected-folder behavior testable without profiles.
 * Missing/disabled/invalid XDG data falls back to ~/Documents; I/O failures do not.
 */
export function defaultDesignProjectsRoot(options: DocumentsEnvironment = {}): string {
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  if (platform === 'win32') {
    try {
      const documents = (options.windowsDocuments ?? (() => windowsDocuments(env)))()
      if (!documents || !win32.isAbsolute(documents)
        || !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/iu.test(documents)
        || /[\u0000-\u001f\u007f]/u.test(documents)) {
        throw new Error('MyDocuments did not return an absolute path')
      }
      return win32.join(documents, 'YuGoo', 'Projects')
    } catch (cause) {
      throw new Error('Cannot resolve Windows Documents. Configure projectsRoot (Companion: --projects-root) to create a project.', { cause })
    }
  }
  if (!posix.isAbsolute(home)) throw new Error('Cannot resolve an absolute user home directory')
  let documents = posix.join(home, 'Documents')
  if (platform === 'linux') {
    const configRoot = env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME : posix.join(home, '.config')
    try {
      const text = (options.readConfig ?? (path => readFileSync(path, 'utf8')))(posix.join(configRoot, 'user-dirs.dirs'))
      documents = xdgDocuments(text, home) ?? documents
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return posix.join(documents, 'YuGoo', 'Projects')
}

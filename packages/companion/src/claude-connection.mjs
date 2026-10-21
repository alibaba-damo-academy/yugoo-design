/** Linux native Claude Hook ancestry. Never infer identity from a process name alone. */
import { readFile, readlink } from 'node:fs/promises'

export function isClaudeExecutable(exe) {
  if (typeof exe !== 'string' || !exe.startsWith('/') || exe.includes('/../') || exe.endsWith(' (deleted)')) return false
  return /\/node_modules\/@anthropic-ai\/claude-code\/bin\/claude(?:\.exe)?$/.test(exe)
    || /\/\.local\/share\/claude\/versions\/\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(exe)
}

export async function claudeProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid native PID.')
  const [exe, stat] = await Promise.all([readlink(`/proc/${pid}/exe`), readFile(`/proc/${pid}/stat`, 'utf8')])
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
  const parent = Number(fields[1]), procStart = fields[19]
  if (!Number.isSafeInteger(parent) || parent < 0 || !/^\d+$/.test(procStart ?? '')) throw new Error('Invalid native process identity.')
  return { pid, parent, procStart, claude: isClaudeExecutable(exe) }
}

export async function nativeClaudeHookProcess() {
  let pid = process.ppid
  for (let i = 0; i < 8 && pid > 1; i++) {
    const current = await claudeProcess(pid)
    if (current.claude) return { pid, procStart: current.procStart }
    pid = current.parent
  }
  throw new Error('Hook is not running under a supported native Claude Code process (Linux).')
}

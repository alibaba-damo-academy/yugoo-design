/** Native Hook process identity, without the optional cross-session registry. */
import { readFile, readlink } from 'node:fs/promises'

export async function qoderProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid native PID.')
  const [exe, stat] = await Promise.all([readlink(`/proc/${pid}/exe`), readFile(`/proc/${pid}/stat`, 'utf8')])
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return { pid, procStart: fields[19], parent: Number(fields[1]), qoder: /\/qodercli-\d+\.\d+\.\d+$/.test(exe) }
}
export async function nativeQoderHookProcess() {
  let pid = process.ppid
  for (let i = 0; i < 8 && pid > 1; i++) {
    const current = await qoderProcess(pid)
    if (current.qoder) return { pid, procStart: current.procStart }
    pid = current.parent
  }
  throw new Error('Hook is not running under a supported native Qoder process (Linux).')
}

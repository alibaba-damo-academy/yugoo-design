import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Public command admission; never substitute a model prompt for a command. */
export interface DesignCommandRemote {
  execute(sessionId: string, line: string, images: readonly never[]): Promise<RemoteResult<{
    result: { kind: string; text?: string }
  } | undefined>>
}

/** Submit through the host command registry and surface refusals to the caller. */
export async function executeDesignCommand(
  remote: DesignCommandRemote | undefined,
  sessionId: string,
  line: string,
): Promise<void> {
  if (remote === undefined) throw new Error('design panel: host command API unavailable')
  const response = await remote.execute(sessionId, line, [])
  if (!response.ok) throw new Error(`design command: ${response.error.code}: ${response.error.message}`)
  if (response.value === undefined) throw new Error(`design command: unknown or malformed command: ${line}`)
  if (response.value.result.kind === 'error') throw new Error(response.value.result.text ?? 'design command failed')
}

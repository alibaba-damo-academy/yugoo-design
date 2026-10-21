/** Claude Code adapter for the shared native Hook inbox. */
import { createNativeHookTransport } from './native-hook-transport.mjs'
import { claudeProcess, nativeClaudeHookProcess } from './claude-connection.mjs'
export const CLAUDE_NOTICE_FILE = '.design-system-claude-notify'
const transport = createNativeHookTransport({ host: 'claude-code', label: 'Claude Code', noticeFile: CLAUDE_NOTICE_FILE,
  inspectProcess: async pid => { const result = await claudeProcess(pid); return { ...result, supported: result.claude } },
  nativeHookProcess: nativeClaudeHookProcess })
export const createClaudeHookConnection = transport.createConnection
export const receiveClaudeHook = transport.receiveHook
export const registerClaudeHook = transport.registerHook

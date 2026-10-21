/** Optional historical UST tool metadata for native transcript projection; no report admission. */
export function mainReportOperation(tool, args, { host } = {}) {
  // WorkBuddy's native deferred-tool dispatcher records the real MCP call in
  // params. Recognize only this observed host grammar, never arbitrary nesting,
  // shell text, ToolSearch results or a caller-provided identity envelope.
  if (host === 'workbuddy' && tool === 'DeferExecuteTool') {
    if (typeof args === 'string') {
      if (Buffer.byteLength(args) > 524288) return undefined
      try { args = JSON.parse(args) } catch { return undefined }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
    return mainReportOperation(args.toolName, args.params)
  }
  if (typeof tool !== 'string' || !(tool === 'report_design_clarity' || tool.endsWith('__report_design_clarity'))) return undefined
  if (typeof args === 'string') {
    if (Buffer.byteLength(args) > 524288) return undefined
    try { args = JSON.parse(args) } catch { return undefined }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.connection !== 'string') return undefined
  const { connection, input, summary, u, s, t, nextGap } = args
  return { connection, input, assessment: { summary, u, s, t, ...(nextGap === undefined ? {} : { nextGap }) } }
}

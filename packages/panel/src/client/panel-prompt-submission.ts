/** Use the Host-owned submission echo without claiming that an Agent has run. */
export interface PanelPromptSession<T> {
  /** Public Host snapshot: only explicit null proves a non-addressed Session. */
  getSnapshot?: () => { readonly subagent?: unknown }
  beginSubmission?: (input: { mode: 'queue'; text: string; attachments: readonly never[] }) => {
    readonly requestId: string
    abandon(): void
  }
  prompt(content: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue',
    signal?: AbortSignal, requestId?: string): Promise<T>
}

/** Existing explicit receipt ids remain unchanged; never mint a second user message. */
export async function submitDesignPanelPrompt<T extends { readonly ok: boolean }>(
  session: PanelPromptSession<T>, text: string, requestId?: string,
  onAdmitted?: (requestId: string) => void,
): Promise<T> {
  let rootSession = false
  try { rootSession = session.getSnapshot?.()?.subagent === null } catch { /* Unknown identity cannot authorize an echo. */ }
  // RC2 addressed-child prompt routing mints its own request identity. Do not
  // create a root-style echo which that route cannot reconcile on admission.
  const submission = requestId === undefined && rootSession
    ? session.beginSubmission?.({ mode: 'queue', text, attachments: [] })
    : undefined
  try {
    const id = requestId ?? submission?.requestId
    const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, id)
    if (!result.ok) submission?.abandon()
    // Correlation is strictly post-admission and cannot delay or invalidate the
    // ordinary Host prompt. Unknown/child routes cannot borrow a root rpcId.
    if (result.ok && rootSession && id !== undefined) {
      try { onAdmitted?.(id) } catch { /* Optional assessment is not prompt admission. */ }
    }
    return result
  } catch (error) {
    submission?.abandon()
    throw error
  }
}

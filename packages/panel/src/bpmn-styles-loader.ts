/** Browser-only initialization: importing this API does not execute CSS.
 * All diagram consumers await the same three stylesheet modules. Their existing
 * host-owned CSS loader retains font preprocessing, deduplication and teardown.
 */
export async function loadBpmnStyles(): Promise<void> {
  await Promise.all([
    import('bpmn-js/dist/assets/diagram-js.css'),
    import('bpmn-js/dist/assets/bpmn-js.css'),
    import('bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'),
  ])
}

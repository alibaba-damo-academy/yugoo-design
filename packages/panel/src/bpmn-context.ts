/** Read-only business context from the BPMN model already loaded by the canvas.
 * The diagram remains the authority for names, lanes and sequence flows. */
interface SequenceFlow {
  name?: string
  sourceRef?: { id: string }
  targetRef?: { id: string; name?: string }
  conditionExpression?: { body?: string }
}
interface BusinessObject extends SequenceFlow {
  id: string
  name?: string
  $type?: string
  flowNodeRef?: readonly BusinessObject[]
  outgoing?: readonly SequenceFlow[]
}
export interface BpmnElementContext {
  id: string
  name?: string
  performer?: string
  outgoing: readonly { label?: string; target: string }[]
}
export function bpmnElementContexts(elements: readonly { id: string; type?: string; labelTarget?: unknown; businessObject?: BusinessObject }[]): BpmnElementContext[] {
  const lanes = elements.filter(element => element.type === 'bpmn:Lane' && element.businessObject?.name).map(element => element.businessObject!)
  return elements.filter(element => !element.labelTarget && element.businessObject && element.type !== 'bpmn:Lane')
    .map(element => {
      const object = element.businessObject!
      const performer = lanes.filter(lane => lane.flowNodeRef?.some(node => node.id === object.id)).map(lane => lane.name).join(' · ')
      // sourceRef/targetRef are authoritative even when the XML omits optional
      // incoming/outgoing back-references on its flow nodes.
      const edges = elements.filter(item => item.type === 'bpmn:SequenceFlow' && item.businessObject?.sourceRef?.id === object.id).map(item => item.businessObject!)
      return { id: element.id, ...(object.name ? { name: object.name } : {}), ...(performer ? { performer } : {}),
        outgoing: (edges.length ? edges : object.outgoing ?? []).flatMap(flow => flow.targetRef ? [{
          ...(flow.name || flow.conditionExpression?.body ? { label: flow.name || flow.conditionExpression?.body } : {}),
          target: flow.targetRef.name || flow.targetRef.id,
        }] : []) }
    })
}

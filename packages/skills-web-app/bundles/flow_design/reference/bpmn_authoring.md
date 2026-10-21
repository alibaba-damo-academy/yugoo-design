# BPMN authoring contract

This is the authoritative contract for one `flow_design` BPMN artifact. The
foreground Producer reads it for serial authorship and supplies it with any
bounded delegated assignment. A Worker writes only its exact pre-bound BPMN
file, runs the Bundle layout and final validator, and repairs it in the same
active Worker loop. The Producer reads the landed file receipt and updates
canonical JSON, or authors and repairs the same XML itself when delegation is
not useful.

## Output boundary

- Output one complete `<bpmn:definitions>` document containing exactly one
  `<bpmn:process>`.
- Author structure first. The same Agent then runs the Bundle layout script and
  persists its `bpmndi:*`, `dc:*`, and `di:*` output as the final file.
- Use Chinese for visible `name` values and ASCII-only machine ids.
- Every node and sequence-flow id uses `{ElementType}_{process_id}_{number}`.
  Every lane id uses `Lane_{process_id}_{number}`. Role names belong only in
  lane `name`, never in ids.
- Include exactly one start event and at least one named end event. Every
  `sourceRef`, `targetRef`, and `flowNodeRef` resolves inside this process.
- Every flow node is reachable from that start and every active path reaches a
  named end. Do not place a disconnected admin/maintenance mini-flow beside
  the main narrative; make it a separate material process or omit it.

## Product boundary and lanes

`系统` is the product being designed, not an invented organization role. The
brief always states its grounded responsibilities. Realize those
responsibilities in the `系统` lane; if a proposed process has no product
responsibility, it should not have reached this worker.

For two or more participating roles, create exactly one lane per supplied role
and put every flow node in exactly one lane. For a single-role process, omit the
laneSet. Cross-lane sequence flows are valid.

Inside a lane, refer to an independently defined node only as:

```xml
<bpmn:flowNodeRef>ExclusiveGateway_P-001_1</bpmn:flowNodeRef>
```

Never turn an id into a tag name:

```xml
<!-- Invalid: this is not a BPMN element type. -->
<bpmn:exclusiveGateway_P-001_1 />
```

## Choose semantic nodes from evidence

Use the most specific evidenced BPMN node. Do not use richer glyphs merely as
decoration and do not flatten known semantics into generic tasks.

| Business meaning | BPMN element |
|---|---|
| Human works in/with the product | `userTask` in that human role lane |
| Human performs offline work | `manualTask` in that human role lane |
| Product runs an automated operation | `serviceTask` in `系统` |
| Product evaluates a stated decision table/rule | `businessRuleTask` in `系统` |
| Product sends a message/notification | `sendTask` in `系统` |
| Product waits for a message | `receiveTask` in `系统` |
| Evidence does not distinguish a more specific activity | `task` |

Never place `userTask`/`manualTask` in `系统`. Never place
`serviceTask`/`businessRuleTask`/`sendTask`/`receiveTask` in a human lane.

Use gateways by their actual control-flow semantics:

- `exclusiveGateway`: exactly one outcome proceeds. Name the gateway as a
  question and every outgoing branch as its concrete answer.
- `parallelGateway`: concurrent split or synchronization join. A process with
  `process_type=parallel` must show the explicit split and, where the branches
  synchronize, its matching join.
- `eventBasedGateway`: wait for the first of at least two evidenced events.
  Every outgoing flow targets an `intermediateCatchEvent` or `receiveTask`.
- Do not substitute an exclusive gateway for parallel or event-race behavior.

Start from the happy path, then add only grounded decisions, exceptions, and
feedback paths. Keep splits and joins explicit. Do not invent a timeout,
message, error, condition, or signal that is absent from `trigger_hints`.

Before the first file mutation, settle a compact inventory of lanes, semantic
nodes, event definitions, and sequence paths against the canonical process
descriptor. Write one coherent structure-only BPMN candidate. After a
validator diagnostic, repair the existing candidate with a targeted edit;
do not repeatedly replace the whole file merely to reconsider modeling that
should have been resolved from the descriptor first.

## Trigger hints become event definitions

Every trigger hint in the brief must appear as the matching event definition
on an appropriate start/intermediate/boundary/end event:

| `trigger_hints[].kind` | Required definition |
|---|---|
| `timer` | `timerEventDefinition` |
| `message` | `messageEventDefinition` |
| `error` | `errorEventDefinition` |
| `conditional` | `conditionalEventDefinition` |
| `signal` | `signalEventDefinition` |

This table applies only after the plan has classified a fact as a genuine
event. Do not use `trigger_hints` for an ordinary gateway condition or for a
deterministic effect of the preceding task. For example, “mark closed, then
archive” is a service task followed by another service task (or one combined
service task), not a conditional catch event. A conditional event is
appropriate only when the process independently waits for or observes a
condition that may become true outside the immediately preceding activity.

A boundary event is active only while its attached activity is active. Attach
a timer to the long-running wait, review, approval, or receive activity whose
duration it monitors. Never attach a timeout to an instantaneous task that
merely initializes status; the timer would cease to exist as soon as that task
finishes.

Example timeout structure (adapt the ids and semantics; do not copy blindly):

```xml
<bpmn:userTask id="UserTask_P-001_2" name="确认支付" />
<bpmn:boundaryEvent id="BoundaryEvent_P-001_1" name="等待支付超时"
                    attachedToRef="UserTask_P-001_2" cancelActivity="true">
  <bpmn:timerEventDefinition id="TimerEventDefinition_P-001_1">
    <bpmn:timeDuration>PT24H</bpmn:timeDuration>
  </bpmn:timerEventDefinition>
</bpmn:boundaryEvent>
```

Only encode a concrete duration/expression when the brief provides it. A
trigger is incomplete unless its sequence path reaches the supplied expected
outcome.

## Compact complete example

This example demonstrates lane references and typed human/system work. Adapt
the structure to the brief; never copy its business facts or ids blindly.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_P-001"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_P-001" name="请假审批" isExecutable="false">
    <bpmn:laneSet id="LaneSet_P-001">
      <bpmn:lane id="Lane_P-001_1" name="员工">
        <bpmn:flowNodeRef>StartEvent_P-001_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>UserTask_P-001_1</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_P-001_2" name="直属领导">
        <bpmn:flowNodeRef>UserTask_P-001_2</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>ExclusiveGateway_P-001_1</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_P-001_3" name="系统">
        <bpmn:flowNodeRef>SendTask_P-001_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>SendTask_P-001_2</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>EndEvent_P-001_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>EndEvent_P-001_2</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_P-001_1" name="员工准备申请" />
    <bpmn:userTask id="UserTask_P-001_1" name="填写请假申请" />
    <bpmn:userTask id="UserTask_P-001_2" name="审批请假申请" />
    <bpmn:exclusiveGateway id="ExclusiveGateway_P-001_1" name="是否通过" />
    <bpmn:sendTask id="SendTask_P-001_1" name="发送通过通知" />
    <bpmn:sendTask id="SendTask_P-001_2" name="发送驳回通知" />
    <bpmn:endEvent id="EndEvent_P-001_1" name="通过结果已送达" />
    <bpmn:endEvent id="EndEvent_P-001_2" name="驳回结果已送达" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_1" sourceRef="StartEvent_P-001_1" targetRef="UserTask_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_2" sourceRef="UserTask_P-001_1" targetRef="UserTask_P-001_2" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_3" sourceRef="UserTask_P-001_2" targetRef="ExclusiveGateway_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_4" name="通过" sourceRef="ExclusiveGateway_P-001_1" targetRef="SendTask_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_5" name="驳回" sourceRef="ExclusiveGateway_P-001_1" targetRef="SendTask_P-001_2" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_6" sourceRef="SendTask_P-001_1" targetRef="EndEvent_P-001_1" />
    <bpmn:sequenceFlow id="SequenceFlow_P-001_7" sourceRef="SendTask_P-001_2" targetRef="EndEvent_P-001_2" />
  </bpmn:process>
</bpmn:definitions>
```

## Final self-check before submit

1. One connected process, one start, at least one named end. The structure input
   has no DI/layout elements; the final file has the layout script's DI output.
2. All ids are ASCII and process-prefixed; all references resolve.
3. Lane names exactly match supplied stakeholders; every node belongs to one
   responsible lane.
4. `系统` responsibilities are typed system activities; human work stays in
   human lanes.
5. Every supplied trigger hint is realized, and no ungrounded trigger appears.
6. Exclusive outcomes are named; parallel/event-driven shapes use the matching
   gateways.
7. Follow [artifact-contract.md](artifact-contract.md) to validate, lay out and
   validate the final file in place. Repair that file in the active author loop;
   return its receipt, not the complete XML through model messages. A serial
   Producer follows the same repair loop directly.
   Treat XML parser diagnostics as local syntax defects: repair the reported
   token, closing tag, attribute, or namespace without deleting established
   triggers, events, branches, roles, or system responsibilities. A candidate
   passes only when its BPMN semantics still realize the canonical process
   descriptor after syntax repair.

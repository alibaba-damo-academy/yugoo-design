import { readFileSync } from "node:fs";
//#region skills/flow_design/scripts/src/flow-validation.ts
/**
* flow_design BPMN candidate preparation. Ported from the sdk-pilot
* `flow_design/executor.py` validation + `layout_runner.py`: one process's
* generated BPMN XML is extracted from fences and validated without changing
* its process structure. Layout is a separate ordinary Agent script.
*/
const XML_FENCE_RE = /```(?:xml)?\s*([\s\S]*?)```/g;
/** Extract the BPMN XML document from model output (fence-aware). */
function extractXml(text) {
	const candidates = [...text.matchAll(XML_FENCE_RE)].map((match) => match[1] ?? "");
	const candidate = (candidates.filter((candidate) => candidate.includes("<bpmn:definitions") || candidate.includes("<bpmn:process"))[0] ?? candidates[0] ?? text).trim();
	const start = candidate.indexOf("<");
	return start > 0 ? candidate.slice(start) : candidate;
}
function processIdFromBpmn(xml) {
	const processId = /<bpmn:process\b[^>]*\bid=["']Process_([^"']+)["']/u.exec(xml)?.[1]?.trim() ?? "";
	if (processId === "") throw new Error("bpmn_xml must contain one <bpmn:process id=\"Process_{process_id}\">");
	return processId;
}
const FLOW_NODE_ID_RE = /<bpmn:(?:task|userTask|serviceTask|businessRuleTask|scriptTask|manualTask|sendTask|receiveTask|callActivity|subProcess|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|startEvent|endEvent|boundaryEvent|intermediateCatchEvent|intermediateThrowEvent)\b[^>]*?\bid="([^"]+)"/g;
const BPMN_NODE_TAGS = /* @__PURE__ */ new Set([
	"task",
	"userTask",
	"serviceTask",
	"businessRuleTask",
	"scriptTask",
	"manualTask",
	"sendTask",
	"receiveTask",
	"callActivity",
	"subProcess",
	"exclusiveGateway",
	"parallelGateway",
	"inclusiveGateway",
	"complexGateway",
	"eventBasedGateway",
	"startEvent",
	"endEvent",
	"boundaryEvent",
	"intermediateCatchEvent",
	"intermediateThrowEvent"
]);
const BPMN_ACTIVITY_TAGS = /* @__PURE__ */ new Set([
	"task",
	"userTask",
	"serviceTask",
	"businessRuleTask",
	"scriptTask",
	"manualTask",
	"sendTask",
	"receiveTask",
	"callActivity",
	"subProcess"
]);
const BPMN_SYSTEM_ACTIVITY_TAGS = /* @__PURE__ */ new Set([
	"serviceTask",
	"businessRuleTask",
	"scriptTask",
	"sendTask",
	"receiveTask"
]);
const BPMN_TRIGGER_DEFINITIONS = Object.freeze({
	timer: "timerEventDefinition",
	message: "messageEventDefinition",
	error: "errorEventDefinition",
	conditional: "conditionalEventDefinition",
	signal: "signalEventDefinition"
});
function flowNodeIds(xml) {
	return [...xml.matchAll(FLOW_NODE_ID_RE)].map((match) => match[1] ?? "");
}
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function stringList(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}
function xmlAttributes(source) {
	const attributes = {};
	for (const match of source.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		const name = match[1];
		const value = match[2] ?? match[3];
		if (name !== void 0 && value !== void 0) attributes[name] = value;
	}
	return attributes;
}
function bpmnNodes(xml) {
	const nodes = /* @__PURE__ */ new Map();
	for (const match of xml.matchAll(/<bpmn:([A-Za-z][A-Za-z0-9]*)\b([^>]*)>/g)) {
		const tag = match[1];
		if (tag === void 0 || !BPMN_NODE_TAGS.has(tag)) continue;
		const attributes = xmlAttributes(match[2] ?? "");
		const id = attributes.id;
		if (id !== void 0 && id !== "") nodes.set(id, {
			tag,
			attributes
		});
	}
	return nodes;
}
function bpmnSequenceFlows(xml) {
	const flows = [];
	for (const match of xml.matchAll(/<bpmn:sequenceFlow\b([^>]*)>/g)) {
		const attributes = xmlAttributes(match[1] ?? "");
		flows.push({
			id: attributes.id ?? "",
			name: attributes.name ?? "",
			source: attributes.sourceRef ?? "",
			target: attributes.targetRef ?? ""
		});
	}
	return flows;
}
function reachableFrom(seeds, graph) {
	const reached = new Set(seeds);
	const pending = [...seeds].sort();
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === void 0) break;
		for (const neighbour of [...graph.get(current) ?? []].sort()) {
			if (reached.has(neighbour)) continue;
			reached.add(neighbour);
			pending.push(neighbour);
		}
	}
	return reached;
}
function addGraphEdge(graph, source, target) {
	const targets = graph.get(source) ?? /* @__PURE__ */ new Set();
	targets.add(target);
	graph.set(source, targets);
}
function semanticDiagnostic(code, message, repair) {
	return `${code}: ${message} Repair: ${repair}`;
}
/**
* Validate the canonical process plan before any BPMN artifact work begins.
* @param state - complete flow_design state proposed by the Producer.
* @returns actionable plan diagnostics; empty accepts the canonical role cast and active processes.
*/
function flowDesignStateErrors(state) {
	const diagnostics = [];
	const roles = Array.isArray(state.roles) ? state.roles.map(record$1) : [];
	const roleIds = roles.map((role) => typeof role.id === "string" ? role.id.trim() : "");
	const roleNames = roles.map((role) => typeof role.name === "string" ? role.name.trim() : "");
	const normalizedRoleNames = roleNames.map((name) => name.normalize("NFKC").toLowerCase());
	if (roleIds.some((id) => id === "") || roleNames.some((name) => name === "")) diagnostics.push(semanticDiagnostic("flow_design.invalid_role", "every role requires a non-empty id and display name.", "Complete or remove malformed role records before publishing the process plan."));
	const duplicateRoleIds = [...new Set(roleIds.filter((id, index) => id !== "" && roleIds.indexOf(id) !== index))].sort();
	const duplicateRoleNames = [...new Set(roleNames.filter((name, index) => name !== "" && normalizedRoleNames.indexOf(name.normalize("NFKC").toLowerCase()) !== index))].sort();
	if (duplicateRoleIds.length > 0) diagnostics.push(semanticDiagnostic("flow_design.duplicate_role_id", `role ids are duplicated: ${duplicateRoleIds.join(", ")}.`, "Keep one stable id for each product-wide role."));
	if (duplicateRoleNames.length > 0) diagnostics.push(semanticDiagnostic("flow_design.duplicate_role_name", `role names are duplicated: ${duplicateRoleNames.join(", ")}.`, "Keep one canonical display name for each product-wide role and reuse it in every process."));
	const systemRoles = roles.filter((role) => role.id === "System" || role.name === "系统");
	if (systemRoles.length !== 1 || systemRoles[0]?.id !== "System" || systemRoles[0]?.name !== "系统") diagnostics.push(semanticDiagnostic("flow_design.missing_system_role", "the product-wide role cast must contain exactly one canonical role {id: \"System\", name: \"系统\"}.", "Add or normalize the single built-in System/系统 role before describing active processes."));
	const roleNameSet = new Set(roleNames);
	const processes = record$1(state.processes);
	const order = Array.isArray(state.process_order) ? state.process_order : [];
	for (const rawProcessId of order) {
		const processId = String(rawProcessId);
		const process = record$1(processes[processId]);
		if (Object.keys(process).length === 0 || process.deleted === true) continue;
		if (process.process_id !== processId) diagnostics.push(semanticDiagnostic("flow_design.process_id_mismatch", `process map key ${processId} does not match process_id ${JSON.stringify(process.process_id)}.`, "Set process_id to the exact process map key before authoring or laying out BPMN."));
		const stakeholders = stringList(process.stakeholders);
		const unknown = stakeholders.filter((role) => !roleNameSet.has(role));
		if (unknown.length > 0) diagnostics.push(semanticDiagnostic("flow_design.unknown_stakeholder", `process ${processId} uses stakeholders outside the product-wide role cast: ${[...new Set(unknown)].sort().join(", ")}.`, "Reuse exact role names from roles, or establish the missing evidenced role in the shared cast first."));
		if (!stakeholders.includes("系统")) diagnostics.push(semanticDiagnostic("flow_design.system_not_participating", `process ${processId} does not include 系统 as a stakeholder.`, "Add 系统 and its established product responsibility, or omit a procedure in which the product has no responsibility."));
		if (stringList(process.system_responsibilities).length === 0) diagnostics.push(semanticDiagnostic("flow_design.missing_system_responsibility", `process ${processId} does not state any product/system responsibility.`, "Describe what the product validates, stores, decides, sends, or waits for before BPMN authoring."));
	}
	return Object.freeze(diagnostics);
}
/**
* Compare one parsed BPMN process with its canonical Flow Design descriptor.
* @param xml - complete or structure-only BPMN XML after syntax validation.
* @param processId - canonical process id used in diagnostics.
* @param process - canonical process descriptor from flow_design.json.
* @returns actionable semantic diagnostics; empty accepts the process.
*/
function semanticErrors(xml, processId, process) {
	const diagnostics = [];
	const nodes = bpmnNodes(xml);
	const expectedRoles = stringList(process.stakeholders);
	const systemResponsibilities = stringList(process.system_responsibilities);
	const triggerHints = Array.isArray(process.trigger_hints) ? process.trigger_hints.map(record$1).filter((hint) => Object.keys(hint).length > 0) : [];
	const processType = typeof process.process_type === "string" ? process.process_type : "linear";
	const laneNames = [];
	const laneNodes = /* @__PURE__ */ new Map();
	const nodeLanes = /* @__PURE__ */ new Map();
	for (const match of xml.matchAll(/<bpmn:lane\b([^>]*)>([\s\S]*?)<\/bpmn:lane>/g)) {
		const name = (xmlAttributes(match[1] ?? "").name ?? "").trim();
		const refs = [...(match[2] ?? "").matchAll(/<bpmn:flowNodeRef>\s*([^<\s]+)\s*<\/bpmn:flowNodeRef>/g)].map((ref) => ref[1] ?? "").filter((ref) => ref !== "");
		laneNames.push(name);
		laneNodes.set(name, [...laneNodes.get(name) ?? [], ...refs]);
		for (const ref of refs) nodeLanes.set(ref, [...nodeLanes.get(ref) ?? [], name]);
	}
	if (expectedRoles.length >= 2) {
		const missing = expectedRoles.filter((role) => !laneNames.includes(role));
		const unexpected = laneNames.filter((role) => !expectedRoles.includes(role));
		if (missing.length > 0 || unexpected.length > 0) diagnostics.push(semanticDiagnostic("flow_design.lane_role_mismatch", `process ${processId}: lane names do not match participating roles; missing=${missing.join(", ") || "none"}, unexpected=${unexpected.join(", ") || "none"}.`, "Use exactly one lane for each supplied stakeholder and do not invent role names."));
		const duplicated = [...nodeLanes].filter(([, owners]) => owners.length !== 1).map(([nodeId]) => nodeId).sort();
		if (duplicated.length > 0) diagnostics.push(semanticDiagnostic("flow_design.ambiguous_lane_assignment", `process ${processId}: flow nodes belong to more than one lane: ${duplicated.slice(0, 8).join(", ")}.`, "Keep exactly one flowNodeRef for each flow node in exactly one responsible lane."));
	}
	if (expectedRoles.includes("系统")) {
		const systemActivities = [...expectedRoles.length === 1 && laneNames.length === 0 ? new Set(nodes.keys()) : new Set(laneNodes.get("系统") ?? [])].map((nodeId) => [nodeId, nodes.get(nodeId)?.tag]).filter((entry) => entry[1] !== void 0 && BPMN_ACTIVITY_TAGS.has(entry[1]));
		const humanTasks = systemActivities.filter(([, tag]) => tag === "userTask" || tag === "manualTask").map(([nodeId]) => nodeId).sort();
		if (humanTasks.length > 0) diagnostics.push(semanticDiagnostic("flow_design.human_task_in_system_lane", `process ${processId}: system lane contains human-owned tasks: ${humanTasks.slice(0, 8).join(", ")}.`, "Move human/manual actions to a human lane or use an evidenced automated activity type."));
		const genericTasks = systemActivities.filter(([, tag]) => tag === "task").map(([nodeId]) => nodeId).sort();
		if (genericTasks.length > 0) diagnostics.push(semanticDiagnostic("flow_design.untyped_system_task", `process ${processId}: system responsibilities use generic task nodes: ${genericTasks.slice(0, 8).join(", ")}.`, "Use serviceTask, businessRuleTask, sendTask, receiveTask, or scriptTask according to the established responsibility."));
		if (systemResponsibilities.length > 0 && !systemActivities.some(([, tag]) => BPMN_SYSTEM_ACTIVITY_TAGS.has(tag))) diagnostics.push(semanticDiagnostic("flow_design.system_responsibility_unrealized", `process ${processId}: no typed automated activity realizes the supplied system responsibilities.`, "Add system-lane semantic activities for established responsibilities without inventing new ones."));
	}
	for (const [role, refs] of laneNodes) {
		if (role === "系统") continue;
		const automated = refs.filter((ref) => {
			const tag = nodes.get(ref)?.tag;
			return tag !== void 0 && BPMN_SYSTEM_ACTIVITY_TAGS.has(tag);
		}).sort();
		if (automated.length > 0) diagnostics.push(semanticDiagnostic("flow_design.automation_in_human_lane", `process ${processId}: human lane ${JSON.stringify(role)} owns automated activities: ${automated.slice(0, 8).join(", ")}.`, "Move automated work to the 系统 lane and keep human work as userTask or manualTask."));
	}
	const hintedKinds = new Set(triggerHints.map((hint) => typeof hint.kind === "string" ? hint.kind : ""));
	const presentKinds = new Set(Object.entries(BPMN_TRIGGER_DEFINITIONS).filter(([, definition]) => new RegExp(`<bpmn:${definition}\\b`).test(xml)).map(([kind]) => kind));
	triggerHints.forEach((hint, index) => {
		const kind = typeof hint.kind === "string" ? hint.kind : "";
		if (!(kind in BPMN_TRIGGER_DEFINITIONS) || presentKinds.has(kind)) return;
		diagnostics.push(semanticDiagnostic("flow_design.trigger_unrealized", `process ${processId}: declared ${kind} trigger is missing at trigger_hints[${index}]: ${String(hint.trigger ?? "")} -> ${String(hint.expected_outcome ?? "")}.`, `Represent it with bpmn:${BPMN_TRIGGER_DEFINITIONS[kind]} and connect its expected outcome.`));
	});
	const inventedKinds = [...presentKinds].filter((kind) => !hintedKinds.has(kind)).sort();
	if (inventedKinds.length > 0) diagnostics.push(semanticDiagnostic("flow_design.ungrounded_trigger", `process ${processId}: BPMN introduces trigger types absent from trigger_hints: ${inventedKinds.join(", ")}.`, "Remove decorative trigger events or first establish the required trigger in the canonical process plan."));
	const flows = bpmnSequenceFlows(xml);
	const outgoing = /* @__PURE__ */ new Map();
	const adjacency = /* @__PURE__ */ new Map();
	const reverseAdjacency = /* @__PURE__ */ new Map();
	for (const flow of flows) {
		outgoing.set(flow.source, [...outgoing.get(flow.source) ?? [], flow]);
		if (!nodes.has(flow.source) || !nodes.has(flow.target)) continue;
		addGraphEdge(adjacency, flow.source, flow.target);
		addGraphEdge(reverseAdjacency, flow.target, flow.source);
	}
	for (const [nodeId, node] of nodes) {
		if (node.tag !== "boundaryEvent") continue;
		const host = node.attributes.attachedToRef;
		if (host === void 0 || !nodes.has(host)) continue;
		addGraphEdge(adjacency, host, nodeId);
		addGraphEdge(reverseAdjacency, nodeId, host);
	}
	const starts = new Set([...nodes].filter(([, node]) => node.tag === "startEvent").map(([nodeId]) => nodeId));
	const ends = new Set([...nodes].filter(([, node]) => node.tag === "endEvent").map(([nodeId]) => nodeId));
	const reachable = reachableFrom(starts, adjacency);
	const reachesEnd = reachableFrom(ends, reverseAdjacency);
	const unreachable = [...nodes.keys()].filter((nodeId) => !reachable.has(nodeId)).sort();
	const deadEnds = [...nodes.keys()].filter((nodeId) => !reachesEnd.has(nodeId)).sort();
	if (unreachable.length > 0) diagnostics.push(semanticDiagnostic("flow_design.unreachable_nodes", `process ${processId}: nodes are not reachable from the process start: ${unreachable.slice(0, 8).join(", ")}.`, "Connect them to the same start-to-end narrative or remove unrelated nodes."));
	if (deadEnds.length > 0) diagnostics.push(semanticDiagnostic("flow_design.nodes_without_outcome", `process ${processId}: nodes cannot reach any process end: ${deadEnds.slice(0, 8).join(", ")}.`, "Connect each active path to an explicit named end outcome."));
	const gateways = [...nodes].filter(([, node]) => node.tag.endsWith("Gateway"));
	for (const [nodeId, node] of gateways) {
		const branches = outgoing.get(nodeId) ?? [];
		if (node.tag === "exclusiveGateway" && branches.length >= 2) {
			const unnamed = branches.filter((flow) => flow.name.trim() === "").map((flow) => flow.id || `${flow.source}->${flow.target}`);
			if (unnamed.length > 0) diagnostics.push(semanticDiagnostic("flow_design.unnamed_decision_outcome", `process ${processId}: exclusive decision ${nodeId} has unnamed outcomes: ${unnamed.join(", ")}.`, "Name every outgoing outcome with a concrete answer such as 通过/驳回 or 是/否."));
		}
		if (node.tag === "eventBasedGateway") {
			const invalidTargets = branches.map((flow) => flow.target).filter((target) => {
				const tag = nodes.get(target)?.tag;
				return tag !== "intermediateCatchEvent" && tag !== "receiveTask";
			});
			if (branches.length < 2 || invalidTargets.length > 0) diagnostics.push(semanticDiagnostic("flow_design.invalid_event_race", `process ${processId}: event-based gateway ${nodeId} needs at least two catch-event/receive-task branches; invalid targets=${invalidTargets.join(", ") || "none"}.`, "Connect each branch directly to an evidenced intermediateCatchEvent or receiveTask."));
		}
	}
	if (processType === "parallel" && !gateways.some(([nodeId, node]) => node.tag === "parallelGateway" && (outgoing.get(nodeId)?.length ?? 0) >= 2)) diagnostics.push(semanticDiagnostic("flow_design.parallel_shape_unrealized", `process ${processId}: process_type=parallel has no explicit parallel split gateway.`, "Use a parallelGateway for the evidenced concurrent branches and a join where they synchronize."));
	if (processType === "event_driven" && !gateways.some(([, node]) => node.tag === "eventBasedGateway")) diagnostics.push(semanticDiagnostic("flow_design.event_driven_shape_unrealized", `process ${processId}: process_type=event_driven has no eventBasedGateway.`, "Model the evidenced event race with an eventBasedGateway and catching events or receive tasks."));
	return Object.freeze(diagnostics);
}
/**
* Structural rules for one process's BPMN XML (sdk-pilot `_structural_errors`).
* @param xml - the candidate BPMN XML exactly as authored after fence extraction.
* @param processId - the owning process id (element-id prefix rule).
* @param roleCount - the process's stakeholder count (swimlane gate).
* @returns all structural error messages; empty means the structure passes.
*/
function structuralErrors(xml, processId, roleCount) {
	const errors = [];
	if (countMatches(xml, "<bpmn:process") !== 1) errors.push("must contain exactly one <bpmn:process>");
	if (countMatches(xml, "<bpmn:startEvent") !== 1) errors.push("must contain exactly one <bpmn:startEvent>");
	if (!xml.includes("<bpmn:endEvent")) errors.push("must contain at least one <bpmn:endEvent>");
	if (/<(bpmndi|dc|di):/.test(xml)) errors.push("must not contain bpmndi/dc/di elements");
	if (!xml.includes(`_${processId}_`)) errors.push(`element ids must be prefixed with the process id (${processId})`);
	const ids = new Set(flowNodeIds(xml));
	const dangling = [...new Set([...xml.matchAll(/(?:sourceRef|targetRef)="([^"]+)"/g)].map((match) => match[1] ?? ""))].filter((endpoint) => !ids.has(endpoint)).sort();
	if (dangling.length > 0) errors.push(`every sequenceFlow sourceRef/targetRef must reference a declared flow node (task/gateway/event) that is defined with a matching id — declare the missing node(s) or fix the flow. Undeclared ids referenced by flows: ${dangling.slice(0, 8).join(", ")}`);
	if (roleCount >= 2) {
		const laneCount = [...xml.matchAll(/<bpmn:lane\b/g)].length;
		if (!xml.includes("<bpmn:laneSet")) errors.push(`process has ${roleCount} roles — must contain a <bpmn:laneSet> with one <bpmn:lane> per role (see swimlane rule in the brief)`);
		else if (laneCount < 2) errors.push(`process has ${roleCount} roles but only ${laneCount} <bpmn:lane> — one lane per role`);
		else {
			const referenced = new Set([...xml.matchAll(/<bpmn:flowNodeRef>\s*([^<\s]+)\s*<\/bpmn:flowNodeRef>/g)].map((match) => match[1] ?? ""));
			const orphans = [...ids].filter((id) => !referenced.has(id)).sort();
			if (orphans.length > 0) errors.push(`every flow node must be referenced by exactly one lane via <bpmn:flowNodeRef>; missing: ${orphans.slice(0, 6).join(", ")}`);
		}
	}
	return errors;
}
function countMatches(haystack, needle) {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index >= 0) {
		count += 1;
		index = haystack.indexOf(needle, index + 1);
	}
	return count;
}
function processRecords(state) {
	const processes = typeof state.processes === "object" && state.processes !== null && !Array.isArray(state.processes) ? state.processes : {};
	const records = {};
	for (const [processId, process] of Object.entries(processes)) if (typeof process === "object" && process !== null && !Array.isArray(process)) records[processId] = process;
	return records;
}
function activeProcessIds(state, processes) {
	if (Array.isArray(state.process_order)) return Object.freeze(state.process_order.filter((processId) => typeof processId === "string" && processId !== ""));
	return Object.freeze(Object.keys(processes).sort());
}
function artifactText(artifacts, path) {
	const artifact = artifacts[path];
	return typeof artifact === "string" ? artifact : void 0;
}
function structureOnlyBpmn(xml) {
	return xml.replace(/<bpmndi:BPMNDiagram\b[\s\S]*?<\/bpmndi:BPMNDiagram\s*>/giu, "");
}
function layoutErrors(xml) {
	const diagnostics = [];
	if (!/<bpmndi:BPMNDiagram\b/u.test(xml) || !/<bpmndi:BPMNPlane\b/u.test(xml)) diagnostics.push("must contain a BPMNDiagram and BPMNPlane produced by the Bundle layout script");
	// Preserve previously supported revisions; revision 12 is balanced reading
	// order plus route-only channel spacing. Validation never re-lays out files.
	if (!/autoagent:layoutRevision=["'](9|10|11|12)["']/u.test(xml)) diagnostics.push("must carry supported autoagent:layoutRevision=9, 10, 11 or 12 from the Bundle layout script");
	const refs = (tag) => new Set([...xml.matchAll(new RegExp(`<bpmndi:${tag}\\b([^>]*)>`, "giu"))].map((match) => /\bbpmnElement=["']([^"']+)["']/u.exec(match[1] ?? "")?.[1]).filter(Boolean));
	const shapeRefs = refs("BPMNShape");
	const edgeRefs = refs("BPMNEdge");
	const missingShapes = flowNodeIds(xml).filter((id) => !shapeRefs.has(id));
	if (missingShapes.length > 0) diagnostics.push(`layout is missing BPMNShape entries for: ${missingShapes.slice(0, 8).join(", ")}`);
	const flowIds = [...xml.matchAll(/<bpmn:(?:sequenceFlow|messageFlow)\b[^>]*\bid=["']([^"']+)["']/giu)].map((match) => match[1] ?? "");
	const missingEdges = flowIds.filter((id) => !edgeRefs.has(id));
	if (missingEdges.length > 0) diagnostics.push(`layout is missing BPMNEdge entries for: ${missingEdges.slice(0, 8).join(", ")}`);
	if ([...xml.matchAll(/<dc:Bounds\b/giu)].length < shapeRefs.size) diagnostics.push("every BPMNShape must contain dc:Bounds");
	if ([...xml.matchAll(/<di:waypoint\b/giu)].length < edgeRefs.size * 2) diagnostics.push("every BPMNEdge must contain at least two di:waypoint entries");
	for (const match of xml.matchAll(/<bpmndi:BPMNEdge\b([^>]*)>([\s\S]*?)<\/bpmndi:BPMNEdge\s*>/giu)) {
		const attributes = match[1] ?? "";
		const edgeId = /\bid=["']([^"']+)["']/u.exec(attributes)?.[1] ?? "";
		const elementId = /\bbpmnElement=["']([^"']+)["']/u.exec(attributes)?.[1] ?? "";
		if (elementId !== "" && edgeId !== `${elementId}_di`) diagnostics.push(`BPMNEdge ${edgeId || "(missing id)"} must use the layout-script id ${elementId}_di`);
		const waypoints = [...(match[2] ?? "").matchAll(/<di:waypoint\b[^>]*\bx=["']([^"']+)["'][^>]*\by=["']([^"']+)["'][^>]*\/?\s*>/giu)]
			.map((waypoint) => ({ x: Number(waypoint[1]), y: Number(waypoint[2]) }));
		for (let index = 1; index < waypoints.length; index += 1) {
			const previous = waypoints[index - 1];
			const current = waypoints[index];
			if (previous === void 0 || current === void 0) continue;
			if (Math.abs(previous.x - current.x) > 0.01 && Math.abs(previous.y - current.y) > 0.01) {
				diagnostics.push(`BPMNEdge ${edgeId || elementId || "(unknown)"} must use orthogonal waypoint segments from the Bundle layout script`);
				break;
			}
		}
	}
	return diagnostics;
}
/**
* Validate every BPMN artifact referenced by a complete Producer working copy.
*
* This is an integration validator: it has no Design Files effects and is
* valid for both serial Producer authorship and direct Worker files. The
* persisted document may already carry deterministic BPMN DI, so structural
* rules run against its process portion while the semantic engine parses the
* complete document.
* @param state - complete authored Flow state.
* @param artifacts - complete Flow artifact set in the working copy.
* @returns actionable diagnostics; empty accepts the complete artifact set.
*/
async function validateFlowDesignProducerArtifacts(state, artifacts) {
	const diagnostics = [];
	const processes = processRecords(state);
	for (const processId of activeProcessIds(state, processes)) {
		const process = processes[processId];
		if (process === void 0) {
			diagnostics.push(`process ${processId}: active process entry is missing`);
			continue;
		}
		if (process.deleted === true) continue;
		const configuredPath = process.bpmn_file;
		if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
			diagnostics.push(`process ${processId}: active process has no BPMN artifact reference`);
			continue;
		}
		const path = configuredPath.startsWith("flow_design/") ? configuredPath : `flow_design/${configuredPath}`;
		const xml = artifactText(artifacts, path);
		if (xml === void 0) {
			diagnostics.push(`process ${processId}: BPMN artifact ${path} must be UTF-8 text in the complete Producer working copy; clear bpmn_file until a validated replacement lands`);
			continue;
		}
		if (xml.trim() === "") {
			diagnostics.push(`process ${processId}: BPMN artifact ${path} is empty`);
			continue;
		}
		if (extractXml(xml) !== xml.trim()) {
			diagnostics.push(`process ${processId}: BPMN artifact ${path} must contain XML only, without a Markdown fence or preamble`);
			continue;
		}
		const structure = structureOnlyBpmn(xml);
		const stakeholders = Array.isArray(process.stakeholders) ? process.stakeholders : [];
		diagnostics.push(...layoutErrors(xml).map((message) => `process ${processId}: ${message}`));
		diagnostics.push(...structuralErrors(structure, processId, stakeholders.length).map((message) => `process ${processId}: ${message}`));
		diagnostics.push(...semanticErrors(structure, processId, process));
	}
	return Object.freeze(diagnostics);
}
//#endregion
//#region skills/flow_design/scripts/src/cli.ts
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	return value;
}
function fileInput() {
	const raw = readFileSync(0, "utf8");
	const separator = raw.indexOf("\n");
	if (separator < 0) throw new Error("file input must include structured context");
	return {
		context: record(JSON.parse(raw.slice(0, separator)), "context"),
		xml: raw.slice(separator + 1)
	};
}
function result(diagnostics, extra = {}) {
	process.stdout.write(`${JSON.stringify({
		valid: diagnostics.length === 0,
		diagnostics,
		...extra
	})}\n`);
	if (diagnostics.length > 0) process.exitCode = 1;
}
const operation = process.argv[2];
try {
	if (operation === "validate-bpmn-file" || operation === "validate-final-bpmn-file") {
		const { context, xml: rawXml } = fileInput();
		const processId = typeof context.process_id === "string" ? context.process_id.trim() : "";
		if (processId === "") throw new Error("process_id must be non-empty text");
		const processRecord = record(context.process, "process");
		const xml = extractXml(rawXml);
		const sourceDiagnostics = operation === "validate-final-bpmn-file" && extractXml(rawXml) !== rawXml.trim()
			? ["BPMN artifact must contain XML only, without a Markdown fence or preamble"]
			: [];
		const structure = operation === "validate-final-bpmn-file" ? structureOnlyBpmn(xml) : xml;
		result([
			...sourceDiagnostics,
			...(operation === "validate-final-bpmn-file" ? layoutErrors(xml) : []),
			...structuralErrors(structure, processId, (Array.isArray(processRecord.stakeholders) ? processRecord.stakeholders : []).length),
			...semanticErrors(structure, processId, processRecord)
		]);
	} else throw new Error("usage: bpmn-validator.mjs <validate-bpmn-file|validate-final-bpmn-file>");
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 2;
}
//#endregion
export {};

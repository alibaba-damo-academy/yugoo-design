import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
/** Scan authored elements once; text in comments and raw-text/RCDATA bodies is not markup. */
function scanHtmlDocument(content) {
	const tags = [], styles = [];
	const rawText = new Set(["script", "style", "textarea", "title", "iframe", "xmp", "noembed", "noframes", "noscript"]);
	function tagEnd(start) {
		let quote;
		for (let index = start; index < content.length; index++) {
			const char = content[index];
			if (quote) { if (char === quote) quote = undefined; }
			else if (char === "\"" || char === "'") quote = char;
			else if (char === ">") return index;
		}
		return -1;
	}
	let offset = 0;
	while (offset < content.length) {
		const start = content.indexOf("<", offset);
		if (start < 0) break;
		if (content.startsWith("<!--", start)) {
			const end = content.indexOf("-->", start + 4);
			if (end < 0) return { tags, styles, error: "HTML structure error: unclosed comment" };
			offset = end + 3;
			continue;
		}
		if (content.startsWith("<![CDATA[", start)) {
			const end = content.indexOf("]]>", start + 9);
			if (end < 0) return { tags, styles, error: "HTML structure error: unclosed CDATA section" };
			offset = end + 3;
			continue;
		}
		if (/^<[!?]/u.test(content.slice(start, start + 2))) {
			const end = tagEnd(start + 2);
			if (end < 0) return { tags, styles, error: "HTML structure error: unclosed declaration" };
			offset = end + 1;
			continue;
		}
		const opening = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/u.exec(content.slice(start));
		if (!opening) { offset = start + 1; continue; }
		const end = tagEnd(start + opening[0].length);
		const name = opening[2].toLowerCase();
		if (end < 0) return { tags, styles, error: `HTML structure error: unclosed <${name}> tag` };
		const source = content.slice(start, end + 1);
		const closing = opening[1] === "/";
		const selfClosing = !closing && /\/\s*>$/u.test(source);
		const tag = { name, closing, selfClosing, attributes: attributesOf(source.slice(opening[0].length, -1)) };
		tags.push(tag);
		offset = end + 1;
		// This bounded scanner does not resolve foreign-content text-element modes.
		// A slash cannot safely end HTML raw-text/RCDATA; diagnose this syntax instead
		// of treating later text as authored elements. Ordinary SVG self-closing tags remain supported.
		if (!closing && selfClosing && rawText.has(name)) return { tags, styles, error: `HTML structure error: unsupported self-closing <${name}/> text element; use explicit opening and closing tags` };
		if (!closing && name === "plaintext") return { tags, styles, error: "HTML structure error: unsupported <plaintext> consumes the remaining document, including closing wrappers" };
		if (!closing && !selfClosing && rawText.has(name)) {
			const close = new RegExp("</" + name + "(?=[\\s/>])", "gi");
			close.lastIndex = offset;
			const match = close.exec(content);
			if (!match) return { tags, styles, error: `HTML structure error: unclosed <${name}> tag` };
			const closeEnd = tagEnd(match.index + match[0].length);
			if (closeEnd < 0) return { tags, styles, error: `HTML structure error: unclosed </${name}> tag` };
			if (name === "style") styles.push(content.slice(offset, match.index));
			tags.push({ name, closing: true, selfClosing: false, attributes: {} });
			offset = closeEnd + 1;
		}
	}
	return { tags, styles };
}
function validateHtmlStructure(document) {
	if (document.error) return document.error;
	for (const name of ["html", "body"]) {
		if (document.tags.filter(tag => tag.name === name && !tag.closing).length !== 1
			|| document.tags.filter(tag => tag.name === name && tag.closing).length !== 1) {
			return `HTML preview must contain exactly one <${name}>...</${name}> document wrapper`;
		}
	}
	const voidTags = /* @__PURE__ */ new Set([
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"link",
		"meta",
		"source",
		"track",
		"wbr"
	]);
	const optionalClose = /* @__PURE__ */ new Set([
		"html",
		"head",
		"body",
		"p",
		"li",
		"tr",
		"td",
		"th",
		"thead",
		"tbody",
		"tfoot",
		"option"
	]);
	const stack = [];
	for (const { name: tag, closing, selfClosing } of document.tags) {
		if (selfClosing) continue;
		if (voidTags.has(tag)) continue;
		if (!closing) {
			stack.push(tag);
			continue;
		}
		if (stack.length === 0) return `HTML structure error: closing </${tag}> with no open tags`;
		const openIndex = stack.lastIndexOf(tag);
		if (openIndex < 0) return `HTML structure error: closing </${tag}> that was never opened`;
		const unclosed = stack.slice(openIndex + 1).filter((open) => !optionalClose.has(open));
		if (unclosed.length > 0) return `HTML structure error: closing </${tag}> while <${unclosed.at(-1)}> is still open`;
		stack.length = openIndex;
	}
	const remaining = stack.filter((tag) => !optionalClose.has(tag));
	return remaining.length === 0 ? null : `HTML structure error: unclosed <${remaining.at(-1)}> tag`;
}
function attributesOf(tag) {
 const attributes = Object.create(null);
 for (const match of tag.matchAll(ATTRIBUTE)) {
  const name = match[1].toLowerCase();
  if (!Object.hasOwn(attributes, name)) attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
 }
 return attributes;
}

const REMOTE_ASSET = /^(?:https?:)?\/\//i;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const DS_TOKEN_DECLARATION = /(?:^|[{;\s])(--ds-[A-Za-z0-9-]+)\s*:/g;
const DS_TOKEN_REFERENCE = /var\(\s*(--ds-[A-Za-z0-9-]+)/g;
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record$2(value) {
	return isRecord$1(value) ? value : {};
}
/** Parse stable Page prototype IDs and connection bindings. */
function parsePagePrototypeMarkup(document) {
	const elementIds = /* @__PURE__ */ new Set();
	const duplicateElementIds = /* @__PURE__ */ new Set();
	const bindings = /* @__PURE__ */ new Map();
	const duplicateBindings = /* @__PURE__ */ new Set();
	const unaddressableBindings = /* @__PURE__ */ new Set();
	for (const { closing, attributes } of document.tags) {
		if (closing) continue;
		const connectionId = attributes["data-prototype-connection"]?.trim();
		const elementId = attributes["data-prototype-id"]?.trim();
		if (elementId === void 0 || elementId === "") {
			if (connectionId !== void 0 && connectionId !== "") unaddressableBindings.add(connectionId);
			continue;
		}
		if (elementIds.has(elementId)) duplicateElementIds.add(elementId);
		elementIds.add(elementId);
		if (connectionId === void 0 || connectionId === "") continue;
		if (bindings.has(connectionId)) duplicateBindings.add(connectionId);
		bindings.set(connectionId, {
			elementId,
			label: attributes["data-prototype-label"]?.trim() ?? ""
		});
	}
	return Object.freeze({
		elementIds,
		duplicateElementIds,
		bindings,
		duplicateBindings,
		unaddressableBindings
	});
}
/**
* Short-circuit gate for candidates that are not yet a parseable document.
* An incomplete or structurally invalid document makes marker and binding
* parsing noise, so later defect checks are skipped until the gate passes.
* @param html - candidate page HTML.
* @returns the gate diagnostic, or undefined when the document is parseable.
*/
function pageHtmlDocumentGate(html, document) {
	if (!/^(?:<!doctype\s+html(?:\s[^>]*)?>\s*)?<html\b[\s\S]*<\/html>\s*$/iu.test(html.trim())) return "artifact must contain one canonical HTML document only, without a Markdown fence or preamble";
	return validateHtmlStructure(document) ?? void 0;
}
/** Deterministic artifact checks; visual quality remains the author's review. */
function pageHtmlDefectDiagnostics(document, markup, state, authoritativeTokens, styleAuthority) {
 const diagnostics = [];
 if (document.tags.some(tag => !tag.closing && tag.attributes.id === "dsh-design-preview-context")) diagnostics.push("HTML must not author reserved Host context element dsh-design-preview-context");
 diagnostics.push(...pageNavigationContextDiagnostics(state));
 if (document.tags.some(tag => !tag.closing && [tag.attributes.src, tag.attributes.href].some(value => typeof value === "string" && REMOTE_ASSET.test(value)))) diagnostics.push("HTML contains a remote asset or navigation URL");
 if (authoritativeTokens !== undefined) diagnostics.push(...pageTokenConformanceDiagnostics(document, authoritativeTokens));
 if (markup.duplicateElementIds.size) diagnostics.push("HTML contains duplicate data-prototype-id values: " + [...markup.duplicateElementIds].join(", "));
 if (markup.duplicateBindings.size) diagnostics.push("HTML binds a page connection more than once: " + [...markup.duplicateBindings].join(", "));
 if (markup.unaddressableBindings.size) diagnostics.push("HTML binds page connections without data-prototype-id: " + [...markup.unaddressableBindings].join(", "));
 const pages = record$2(state.pages);
 const authority = record$2(styleAuthority);
 for (const { closing, attributes: attrs } of document.tags) {
  if (closing) continue;
  const target = attrs["data-prototype-page"];
  if (target !== undefined && !Object.hasOwn(pages, target)) diagnostics.push("HTML references unknown target page: " + target);
  const connection = record$2(record$2(state.connections)[attrs["data-prototype-connection"]]);
  if (target !== undefined && connection.target_page_id !== undefined && target !== connection.target_page_id) diagnostics.push("HTML page target conflicts with connection: " + attrs["data-prototype-connection"]);
  // Optional provenance markers resolve references; they do not prescribe DOM shape or SVG bytes.
  const icon = attrs["data-design-icon"];
  if (icon !== undefined && styleAuthority !== undefined && !Object.hasOwn(record$2(authority.icons), icon)) diagnostics.push("data-design-icon " + JSON.stringify(icon) + " is absent from style_authority.icons");
  const brand = attrs["data-design-brand"];
  if (brand !== undefined && styleAuthority !== undefined && (!brand || brand !== record$2(authority.brand).mark_id)) diagnostics.push("Unknown brand reference: " + JSON.stringify(brand));
 }
 return [...new Set(diagnostics)];
}
/** The --ds-* namespace belongs to Style; check ownership and reference resolution, not CSS taste. */
function pageTokenConformanceDiagnostics(document, authoritativeTokens) {
 const declared = new Set(), unknown = new Set();
 const styles = [...document.styles];
 for (const { closing, attributes } of document.tags) {
  if (closing) continue;
  const inline = attributes.style;
  if (inline !== undefined) styles.push(inline);
 }
 for (const css of styles.map(text => text.replace(CSS_COMMENT, ""))) {
  for (const match of css.matchAll(DS_TOKEN_DECLARATION)) declared.add(match[1]);
  for (const match of css.matchAll(DS_TOKEN_REFERENCE)) if (!Object.hasOwn(authoritativeTokens, match[1])) unknown.add(match[1]);
 }
 const diagnostics = [];
 if (declared.size) diagnostics.push("HTML declares its own --ds-* design tokens instead of consuming the published set: " + [...declared].sort().join(", "));
 if (unknown.size) diagnostics.push("HTML references design tokens missing from the published set: " + [...unknown].sort().join(", "));
 return diagnostics;
}
function commonSpecDiagnostics(state, pages) {
	const spec = state.common_spec;
	const pageRecords = Object.fromEntries(Object.entries(pages).filter(([, page]) => isRecord$1(page)));
	if (!isRecord$1(spec)) return ["page map has no common_spec for cross-page layout, navigation, logo, and component decisions"];
	const diagnostics = [];
	if (typeof spec.layout !== "string" || spec.layout.trim() === "") diagnostics.push("common_spec.layout must describe the cross-page layout decisions");
	const logo = record$2(spec.logo);
	if (typeof logo.description !== "string" || logo.description.trim() === "") diagnostics.push("common_spec.logo.description must describe the shared main logo");
	if (!Array.isArray(spec.shared_components) || spec.shared_components.length === 0) diagnostics.push("common_spec.shared_components must list shared Page components");
	const navigation = Array.isArray(spec.navigation) ? spec.navigation : [];
	const navIds = /* @__PURE__ */ new Set();
	for (const [index, entry] of navigation.entries()) {
		if (!isRecord$1(entry)) {
			diagnostics.push(`common_spec.navigation[${index}] must be an object`);
			continue;
		}
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		if (id === "") diagnostics.push(`common_spec.navigation[${index}].id must be non-empty`);
		else if (navIds.has(id)) diagnostics.push(`common_spec.navigation contains duplicate id ${JSON.stringify(id)}`);
		else navIds.add(id);
		if (typeof entry.label !== "string" || entry.label.trim() === "") diagnostics.push(`common_spec.navigation[${index}].label must be non-empty`);
		if (Object.hasOwn(entry, "icon_ref") && (typeof entry.icon_ref !== "string" || entry.icon_ref.trim() === "")) diagnostics.push(`common_spec.navigation[${index}].icon_ref must be non-empty when present`);
		const target = typeof entry.target_page_id === "string" ? entry.target_page_id.trim() : "";
		if (target === "") continue;
		if (!Object.hasOwn(pageRecords, target)) diagnostics.push(`common_spec.navigation[${index}] references unknown page ${JSON.stringify(target)}`);
	}
	for (const [pageId, page] of Object.entries(pageRecords)) {
		if (Object.hasOwn(page, "uses_shared_layout") && typeof page.uses_shared_layout !== "boolean") diagnostics.push(`page ${JSON.stringify(pageId)} uses_shared_layout must be boolean`);
	}
	return diagnostics;
}
/** Check shared asset references before any Page HTML is generated. */
function pageMapAssetDiagnostics(state, styleAuthority) {
	const diagnostics = commonSpecDiagnostics(state, record$2(state.pages));
	diagnostics.push(...pageNavigationContextDiagnostics(state));
	const spec = record$2(state.common_spec);
	const authority = record$2(styleAuthority);
	const icons = record$2(authority.icons);
	for (const entry of Array.isArray(spec.navigation) ? spec.navigation : []) {
		const ref = record$2(entry).icon_ref;
		if (typeof ref === "string" && ref.trim() !== "" && !(typeof record$2(icons[ref]).svg === "string" && icons[ref].svg.trim() !== "")) {
			diagnostics.push(`common_spec navigation icon_ref ${JSON.stringify(ref)} has no SVG in Design Style; use an existing semantically correct reference or ask the main Agent to revise Design Style before generating affected Pages`);
		}
	}
	const mark = record$2(spec.logo).mark_ref;
	const brand = record$2(authority.brand);
	if (typeof mark === "string" && mark.trim() !== "" && (brand.mark_id !== mark || typeof brand.mark_svg !== "string" || brand.mark_svg.trim() === "")) {
		diagnostics.push(`common_spec logo mark_ref ${JSON.stringify(mark)} has no matching SVG in Design Style; omit an unconfigured mark or request a Design Style revision before generating affected Pages`);
	}
	return diagnostics;
}
/** Preview selection metadata only; actual identity preservation needs click-through verification. */
function pageNavigationContextDiagnostics(state) {
 const diagnostics = [];
 for (const [id, connection] of Object.entries(record$2(state.connections))) {
  if (!isRecord(connection) || !Object.hasOwn(connection, "preview_context")) continue;
  const context = connection.preview_context;
  const label = `connection ${JSON.stringify(id)} preview_context`;
  if (!isRecord(context)) { diagnostics.push(`${label} must be a flat string object`); continue; }
  const entries = Object.entries(context).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > 16) diagnostics.push(`${label} allows at most 16 keys`);
  for (const [key, value] of entries) {
   if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)
    || typeof value !== "string" || value.length > 256) diagnostics.push(`${label} has an unsafe key or non-string/oversized value`);
  }
  if (Buffer.byteLength(JSON.stringify(Object.fromEntries(entries)), "utf8") > 4096) diagnostics.push(`${label} exceeds 4096 UTF-8 bytes`);
 }
 return diagnostics;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record$1(value) { return isRecord(value) ? value : {}; }
/** Validate the landed file without rewriting it or inferring semantic quality. */
function analyzePageHtmlCandidate(pageId, output, state, authoritativeTokens, styleAuthority, document) {
	const html = typeof output === "string" ? output : output.content;
	const diagnostics = [];
	const gate = pageHtmlDocumentGate(html, document);
	if (gate !== void 0) return { kind: "rejected", diagnostics: [gate] };
	const markup = parsePagePrototypeMarkup(document);
	diagnostics.push(...pageHtmlDefectDiagnostics(document, markup, state, authoritativeTokens, styleAuthority));
	const connections = record$1(state.connections);
	const outgoing = Object.entries(connections).filter(([, value]) => isRecord(value) && value.source_page_id === pageId);
	const incomingIds = new Set(Object.entries(connections).filter(([, value]) => isRecord(value) && value.target_page_id === pageId).map(([id]) => id));
	const unknownBindings = [...markup.bindings.keys()].filter((id) => !outgoing.some(([outgoingId]) => outgoingId === id));
	if (unknownBindings.length > 0) {
		const incoming = unknownBindings.filter((id) => incomingIds.has(id));
		const detail = incoming.length > 0 ? `incoming connections: ${incoming.join(", ")}` : `unknown connections: ${unknownBindings.join(", ")}`;
		diagnostics.push(`HTML binds ${detail}`);
	}
	const missingBindings = outgoing.map(([id]) => id).filter((id) => !markup.bindings.has(id));
	if (missingBindings.length > 0) diagnostics.push(`HTML does not bind outgoing connections: ${missingBindings.join(", ")}`);
	if (diagnostics.length > 0) return {
		kind: "rejected",
		diagnostics: Object.freeze(diagnostics)
	};
	return {
		kind: "accepted",
		html,
		markup,
		outgoing
	};
}
/**
* Validate one delegated Page HTML artifact against the fresh Page map.
* @param pageId - assigned canonical Page id.
* @param candidate - delegated artifact content.
* @param state - fresh Page Design working-copy state.
* @param authoritativeTokens - optional token authority derived from the pinned Design Style source.
* @returns actionable diagnostics; empty accepts the candidate.
*/
function validatePageHtmlCandidate(pageId, candidate, state, authoritativeTokens, styleAuthority, document) {
	const page = record$1(state.pages)[pageId];
	if (!isRecord(page)) return Object.freeze([`page ${JSON.stringify(pageId)} is absent from the current Page Design WorkingCopy`]);
	const analysis = analyzePageHtmlCandidate(pageId, candidate, state, authoritativeTokens, styleAuthority, document);
	return analysis.kind === "accepted" ? Object.freeze([]) : analysis.diagnostics;
}
//#endregion
//#region skills/page_design/scripts/src/cli.ts
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	return value;
}
function parseFileInput(text) {
	const boundary = text.indexOf("\n");
	if (boundary < 0) throw new Error("file input must include structured context");
	return {
		context: record(JSON.parse(text.slice(0, boundary)), "context"),
		content: text.slice(boundary + 1)
	};
}
const operation = process.argv[2];
const PAGE_STATE = "page_design/page_design.json";
const STYLE_STATE = "design_style/design_style.json";
const STYLE_TOKENS = "design_style/tokens.css";

// Standalone Bundle script: no dependency on the developer's Core installation.
// Same lexical rules as Core requireDesignFileRelativePath, plus realpath confinement.
function readConfined(root, path) {
	if (typeof path !== "string" || path === "" || path.startsWith("/") || /^[a-z]:/iu.test(path)
		|| path.endsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/u.test(path)
		|| path.split("/").some(part => part === "" || part === "." || part === ".." || part === ".git")) {
		throw new Error("input path must stay inside design_files/: " + path);
	}
	const target = realpathSync(resolve(root, path));
	const rel = relative(root, target);
	if (rel === "" || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
		throw new Error("input realpath escapes design_files/: " + path);
	}
	if (!statSync(target).isFile()) throw new Error("input must be a regular file: " + path);
	return readFileSync(target, "utf8");
}
function fileInputs() {
	if (process.argv.length === 3) return parseFileInput(readFileSync(0, "utf8"));
	const { values } = parseArgs({ args: process.argv.slice(3), options: {
		"design-files": { type: "string" }, "input-file": { type: "string" }, "page-id": { type: "string" },
	} });
	if (!values["design-files"] || !values["input-file"]) throw new Error("native mode requires --design-files ROOT --input-file RELATIVE_PATH");
	const root = realpathSync(values["design-files"]);
	if (operation === "validate-map-file" && values["input-file"] !== PAGE_STATE) throw new Error("map input must be " + PAGE_STATE);
	const paths = operation === "validate-map-file" ? [STYLE_STATE] : [PAGE_STATE, STYLE_STATE, STYLE_TOKENS];
	return { content: readConfined(root, values["input-file"]), context: {
		page_id: values["page-id"],
		input_files: Object.fromEntries(paths.map(path => [path, readConfined(root, path)])),
	} };
}
function fileAuthority(context) {
	const files = record(context.input_files, "input_files");
	const required = path => {
		if (!Object.hasOwn(files, path) || typeof files[path] !== "string") throw new Error("missing required input_files text: " + path);
		return files[path];
	};
	const style = record(JSON.parse(required(STYLE_STATE)), STYLE_STATE);
	const styleAuthority = record(style.config, STYLE_STATE + "#/config");
	if (operation === "validate-map-file") return { style_authority: styleAuthority };
	const state = record(JSON.parse(required(PAGE_STATE)), PAGE_STATE);
	const css = required(STYLE_TOKENS).replace(CSS_COMMENT, "");
	const tokens = Object.fromEntries([...css.matchAll(DS_TOKEN_DECLARATION)].map(match => [match[1], true]));
	if (Object.keys(tokens).length === 0) throw new Error(STYLE_TOKENS + " contains no --ds-* token declarations");
	return { state, style_authority: styleAuthority, authoritative_tokens: tokens };
}
try {
	if (!["validate-map-file", "validate-html-file"].includes(operation)) throw new Error("usage: page-design.mjs validate-map-file | validate-html-file");
	const input = fileInputs();
	// File authority is exclusive: incomplete files never fall back to copied objects.
	const context = Object.hasOwn(input.context, "input_files")
		? { page_id: input.context.page_id, ...fileAuthority(input.context) } : input.context;
	if (operation === "validate-map-file") {
		const { content } = input;
		const state = record(JSON.parse(content), "state");
		const authority = record(context.style_authority, "style_authority");
		const diagnostics = pageMapAssetDiagnostics(state, authority);
		process.stdout.write(`${JSON.stringify({ valid: diagnostics.length === 0, diagnostics })}\n`);
		if (diagnostics.length > 0) process.exitCode = 1;
	} else if (operation === "validate-html-file") {
		const { content: html } = input;
		const pageId = typeof context.page_id === "string" ? context.page_id.trim() : "";
		if (pageId === "") throw new Error("page_id must be non-empty text");
		const state = record(context.state, "state");
		const tokens = context.authoritative_tokens === void 0 ? void 0 : record(context.authoritative_tokens, "authoritative_tokens");
		const styleAuthority = context.style_authority === void 0 ? void 0 : record(context.style_authority, "style_authority");
		const document = scanHtmlDocument(html);
		const rawGate = pageHtmlDocumentGate(html, document);
		const diagnostics = rawGate === void 0 ? validatePageHtmlCandidate(pageId, { content: html }, state, tokens, styleAuthority, document) : [rawGate];
		const markup = parsePagePrototypeMarkup(document);
		process.stdout.write(`${JSON.stringify({
			valid: diagnostics.length === 0,
			diagnostics,
			bindings: Object.fromEntries(markup.bindings)
		})}\n`);
		if (diagnostics.length > 0) process.exitCode = 1;
	} else throw new Error("usage: page-design.mjs validate-map-file | validate-html-file");
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stdout.write(`${JSON.stringify({ valid: false, kind: "input_error", diagnostics: [message] })}\n`);
	process.stderr.write(`input_error: ${message}\n`);
	process.exitCode = 2;
}
//#endregion
export {};

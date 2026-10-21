/**
 * Prototype-host injection and message validation for the page_design preview.
 *
 * The preview iframe renders untrusted artifact HTML under `sandbox='allow-scripts'`
 * (no `allow-same-origin`, no top navigation). A host-authored script — trusted
 * head markup placed after the restrictive CSP meta — marks bound elements,
 * intercepts clicks, posts structured bind/navigate messages to the panel, and
 * (main preview only) reports one visual geometry measurement of the rendered
 * artifact: full-document/body rendering, bound-hotspot visibility, and
 * horizontal overflow.
 * The panel accepts a message only when it arrives from its own iframe
 * (`event.source === iframe.contentWindow`) and matches the exact schema below;
 * connection/page allowlists are then enforced by the panel before any state
 * mutation. The artifact itself never gains a channel to the panel except
 * through this host script's `window.parent.postMessage`.
 */

import { validatePreviewNavigationContext, type PreviewNavigationContext } from 'dsh-design-panel/client-api';
import type { IPageConnection, IPageNode } from './pageDesignTypes.ts';

/** Resolve selection only from an outgoing canonical edge, never frame data. */
export function resolvePrototypeNavigation(
  sourcePageId: string,
  connectionId: string,
  connections: Record<string, IPageConnection>,
  pages: Record<string, IPageNode>
): { targetPageId: string; context?: PreviewNavigationContext } | { error: string } | undefined {
  if (!Object.hasOwn(connections, connectionId)) return undefined;
  const edge = connections[connectionId];
  if (edge.id !== connectionId || edge.source_page_id !== sourcePageId
    || !Object.hasOwn(pages, edge.target_page_id)) return undefined;
  try {
    return {
      targetPageId: edge.target_page_id,
      context: edge.preview_context === undefined ? undefined : validatePreviewNavigationContext(edge.preview_context),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid preview navigation context' };
  }
}

/** One structured message posted from the prototype host script. */
export type PrototypeFrameMessage =
  | {
      source: 'page-design-prototype';
      type: 'bind-hotspot';
      connectionId: string;
      elementId: string;
      elementLabel: string;
    }
  | {
      source: 'page-design-prototype';
      type: 'navigate';
      connectionId: string;
    }
  | {
      source: 'page-design-prototype';
      type: 'navigate-page';
      pageId: string;
    }
  | {
      source: 'page-design-prototype';
      type: 'geometry-report';
      pageId: string;
      previewToken: string;
      issues: readonly string[];
    };

/** Prototype host configuration derived from the selected page's connections. */
export interface PrototypeHostConfig {
  /** Connection currently awaiting a hotspot pick, or null when not binding. */
  bindingConnectionId: string | null;
  /** Connections already bound to a source element (connectionId → elementId). */
  bindings: readonly { connectionId: string; elementId: string }[];
  /**
   * Visual geometry check for the main preview; thumbnails omit it. The host
   * script measures the rendered artifact after load and posts one
   * `geometry-report` echoing `pageId` + `previewToken` so the panel can
   * discard reports from stale preview documents.
   */
  geometry?: {
    /** Page id echoed in the geometry report. */
    pageId: string;
    /** Monotonic token of the srcDoc instance that carries this config. */
    previewToken: string;
    /** `data-prototype-id` of each bound hotspot that must render visible. */
    regions: readonly string[];
  };
}

/** Escape `<` so an embedded JSON literal cannot close the host `<script>`. */
function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Build the trusted head markup: a bind-mode style plus the interception
 * script. The script is host-authored; its only dynamic input is the escaped
 * `config` JSON. It never evaluates artifact content as code.
 * @param config - binding mode + current bindings for the selected page.
 * @returns `<style>` + `<script>` markup to prepend into the preview head.
 */
export function prototypeHostMarkup(config: PrototypeHostConfig): string {
  const style =
    '<style id="page-design-prototype">a{cursor:default!important}' +
    '[data-prototype-bound="true"]{cursor:pointer!important}' +
    'body[data-prototype-bind-mode="true"] [data-prototype-id]{cursor:crosshair!important;transition:outline-color 120ms ease,box-shadow 120ms ease}' +
    'body[data-prototype-bind-mode="true"] [data-prototype-id]:hover{outline:2px solid var(--ds-primary)!important;outline-offset:2px!important;box-shadow:0 0 0 4px color-mix(in srgb,var(--ds-primary) 14%,transparent)!important}' +
    '</style>';
  const script =
    '<script>(function(){var config=' +
    safeScriptJson(config) +
    ';' +
    'function findByPrototypeId(id){return Array.prototype.find.call(document.querySelectorAll(\'[data-prototype-id]\'),function(item){return item.getAttribute(\'data-prototype-id\')===id})}' +
    'function prepare(){document.body.dataset.prototypeBindMode=config.bindingConnectionId?\'true\':\'false\';config.bindings.forEach(function(binding){var item=findByPrototypeId(binding.elementId);if(item){item.setAttribute(\'data-prototype-bound\',\'true\')}})}' +
    'if(document.readyState===\'loading\'){document.addEventListener(\'DOMContentLoaded\',prepare)}else{prepare()}' +
    'document.addEventListener(\'click\',function(event){' +
    'var target=event.target&&event.target.closest?event.target.closest(\'[data-prototype-id]\'):null;' +
    'if(config.bindingConnectionId){event.preventDefault();event.stopImmediatePropagation();if(!target){return}' +
    'window.parent.postMessage({source:\'page-design-prototype\',type:\'bind-hotspot\',connectionId:config.bindingConnectionId,elementId:target.getAttribute(\'data-prototype-id\')||\'\',elementLabel:target.getAttribute(\'data-prototype-label\')||target.getAttribute(\'aria-label\')||(target.textContent||\'\').trim().slice(0,40)},\'*\');return}' +
    'if(target){var elementId=target.getAttribute(\'data-prototype-id\')||\'\';var binding=config.bindings.find(function(item){return item.elementId===elementId});' +
    'if(binding){event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({source:\'page-design-prototype\',type:\'navigate\',connectionId:binding.connectionId},\'*\');return}}' +
    'var pageLink=event.target&&event.target.closest?event.target.closest(\'[data-prototype-page]\'):null;' +
    'if(pageLink){event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({source:\'page-design-prototype\',type:\'navigate-page\',pageId:pageLink.getAttribute(\'data-prototype-page\')||\'\'},\'*\');return}' +
    'var link=event.target&&event.target.closest?event.target.closest(\'a[href]\'):null;' +
    'if(link){event.preventDefault();event.stopImmediatePropagation()}' +
    '},true);' +
    'document.addEventListener(\'submit\',function(event){event.preventDefault()},true);' +
    'window.open=function(){return null};' +
    'function hasVisibleBox(element){var current=element;while(current){var style=window.getComputedStyle(current);if(style.display===\'none\'||style.visibility===\'hidden\'||style.visibility===\'collapse\'||style.contentVisibility===\'hidden\'||Number(style.opacity)===0){return false}if(current===document.body){break}current=current.parentElement}return Array.prototype.some.call(element.getClientRects(),function(rect){return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.left<window.innerWidth&&rect.top<window.innerHeight})}' +
    'function hasVisibleBodyContent(body){var walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);var textNode;while((textNode=walker.nextNode())){if((textNode.nodeValue||\'\').trim()&&textNode.parentElement&&hasVisibleBox(textNode.parentElement)){var range=document.createRange();range.selectNodeContents(textNode);if(Array.prototype.some.call(range.getClientRects(),function(rect){return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.left<window.innerWidth&&rect.top<window.innerHeight})){return true}}}return Array.prototype.some.call(body.querySelectorAll(\'*\'),function(element){return !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|TITLE)$/.test(element.tagName)&&hasVisibleBox(element)})}' +
    'function reportGeometry(){if(!config.geometry){return}var issues=[];var html=document.documentElement;var body=document.body;var htmlCount=document.querySelectorAll(\'html\').length;var bodyCount=document.querySelectorAll(\'body\').length;if(!html||html.tagName!==\'HTML\'||htmlCount!==1||!body||bodyCount!==1||body.parentElement!==html){issues.push(\'document-root:\'+htmlCount+\'/\'+bodyCount)}else if(!hasVisibleBodyContent(body)){issues.push(\'body-empty\')}' +
    'config.geometry.regions.forEach(function(regionId){var element=findByPrototypeId(regionId);if(!element){issues.push(\'region-missing:\'+regionId);return}' +
    'var style=window.getComputedStyle(element);var rect=element.getBoundingClientRect();' +
    'if(style.display===\'none\'||style.visibility===\'hidden\'||rect.width<=0||rect.height<=0){issues.push(\'region-invisible:\'+regionId)}});' +
    'var doc=document.documentElement;if(doc.scrollWidth>doc.clientWidth+1){issues.push(\'horizontal-overflow:\'+doc.scrollWidth)}' +
    'window.parent.postMessage({source:\'page-design-prototype\',type:\'geometry-report\',pageId:config.geometry.pageId,previewToken:config.geometry.previewToken,issues:issues},\'*\')}' +
    'function reportRenderedGeometry(){window.requestAnimationFrame(function(){window.requestAnimationFrame(reportGeometry)})}' +
    'if(document.readyState===\'complete\'){reportRenderedGeometry()}else{window.addEventListener(\'load\',reportRenderedGeometry)}' +
    '})()</script>';
  return style + script;
}

const BIND_HOTSPOT_KEYS = ['connectionId', 'elementId', 'elementLabel', 'source', 'type'].join(',');
const NAVIGATE_KEYS = ['connectionId', 'source', 'type'].join(',');
const NAVIGATE_PAGE_KEYS = ['pageId', 'source', 'type'].join(',');
const GEOMETRY_REPORT_KEYS = ['issues', 'pageId', 'previewToken', 'source', 'type'].join(',');

function sortedKeys(value: Record<string, unknown>): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Validate an untrusted postMessage payload against the exact message schema.
 * Returns undefined for any deviation: a non-object payload, a wrong or absent
 * `source`, an unknown `type`, unexpected or missing fields, or empty ids. The
 * panel treats undefined as "ignore" — it never coerces a partial message.
 * @param data - the raw `event.data` from a window message.
 * @returns the strictly validated message, or undefined when invalid.
 */
export function parsePrototypeMessage(data: unknown): PrototypeFrameMessage | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if (record.source !== 'page-design-prototype') return undefined;
  if (record.type === 'bind-hotspot') {
    if (sortedKeys(record) !== BIND_HOTSPOT_KEYS) return undefined;
    if (typeof record.connectionId !== 'string' || record.connectionId === '') return undefined;
    if (typeof record.elementId !== 'string' || record.elementId === '') return undefined;
    if (typeof record.elementLabel !== 'string') return undefined;
    return {
      source: 'page-design-prototype',
      type: 'bind-hotspot',
      connectionId: record.connectionId,
      elementId: record.elementId,
      elementLabel: record.elementLabel,
    };
  }
  if (record.type === 'navigate') {
    if (sortedKeys(record) !== NAVIGATE_KEYS) return undefined;
    if (typeof record.connectionId !== 'string' || record.connectionId === '') return undefined;
    return { source: 'page-design-prototype', type: 'navigate', connectionId: record.connectionId };
  }
  if (record.type === 'navigate-page') {
    if (sortedKeys(record) !== NAVIGATE_PAGE_KEYS) return undefined;
    if (typeof record.pageId !== 'string' || record.pageId === '') return undefined;
    return { source: 'page-design-prototype', type: 'navigate-page', pageId: record.pageId };
  }
  if (record.type === 'geometry-report') {
    if (sortedKeys(record) !== GEOMETRY_REPORT_KEYS) return undefined;
    if (typeof record.pageId !== 'string' || record.pageId === '') return undefined;
    if (typeof record.previewToken !== 'string' || record.previewToken === '') return undefined;
    if (!Array.isArray(record.issues) || record.issues.length > 64) return undefined;
    const issues: string[] = [];
    for (const issue of record.issues) {
      if (typeof issue !== 'string' || issue === '' || issue.length > 256) return undefined;
      issues.push(issue);
    }
    return {
      source: 'page-design-prototype',
      type: 'geometry-report',
      pageId: record.pageId,
      previewToken: record.previewToken,
      issues,
    };
  }
  return undefined;
}

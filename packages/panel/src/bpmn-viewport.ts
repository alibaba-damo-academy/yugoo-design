/**
 * Viewport policy for rendered BPMN diagrams.
 *
 * Diagram coordinates belong to the BPMN artifact and are intentionally
 * independent of a browser panel's dimensions. The browser may choose a
 * readable width-first viewport for tall diagrams, while native pan and the
 * explicit fit-all action keep the complete diagram reachable.
 */

export const BPMN_NATIVE_LABEL_SIZE = 14;
export const BPMN_TEXT_RENDERER = {
  defaultStyle: { fontSize: BPMN_NATIVE_LABEL_SIZE },
};

// bpmn-js does not publish a narrow TypeScript interface for its canvas
// service. Keep the local surface explicit instead of leaking `any` into both
// the viewer and editor components.
export interface IBpmnCanvasService {
  resized(): void;
  zoom(scale: number | 'fit-viewport'): void;
  viewbox(): IBpmnCanvasViewbox;
  viewbox(box: IBpmnViewboxRect): void;
}

export interface IBpmnViewboxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IBpmnCanvasViewbox extends IBpmnViewboxRect {
  scale: number;
  inner: IBpmnViewboxRect;
  outer: IBpmnViewboxRect;
}

interface IBpmnLaneElement {
  id: string;
  type: string;
  width: number;
}

interface IBpmnElementRegistryService {
  getAll(): IBpmnLaneElement[];
  getGraphics(element: IBpmnLaneElement): SVGElement | undefined;
}

const AUTOAGENT_LANE_HEADER_HEIGHT =
  /\bautoagent:laneHeaderHeight=["'](\d+(?:\.\d+)?)["']/;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Draw the presentation-only divider below a revisioned vertical lane title.
 *
 * BPMN DI has lane bounds and labels but no native "header band" primitive.
 * The layout engine therefore reserves the band in geometry and serializes
 * its height as AutoAgent metadata; the browser owns this final visual line.
 * Legacy authored DI has no metadata and is deliberately left untouched so a
 * divider can never be painted through its first row of nodes.
 */
export function applyBpmnLaneHeaderDividers(
  host: unknown,
  xml: string
): void {
  const rawHeight = AUTOAGENT_LANE_HEADER_HEIGHT.exec(xml)?.[1];
  const headerHeight = rawHeight ? Number(rawHeight) : 0;
  if (!Number.isFinite(headerHeight) || headerHeight <= 0) return;

  const registry = (host as {
    get(service: 'elementRegistry'): IBpmnElementRegistryService;
  }).get('elementRegistry');
  for (const element of registry.getAll()) {
    if (element.type !== 'bpmn:Lane' || element.width <= 0) continue;
    const graphics = registry.getGraphics(element);
    const visual = graphics?.querySelector<SVGElement>('.djs-visual');
    if (!visual || visual.querySelector('.qqt-lane-header-divider')) continue;

    const divider = document.createElementNS(SVG_NAMESPACE, 'line');
    divider.classList.add('qqt-lane-header-divider');
    divider.setAttribute('x1', '0');
    divider.setAttribute('x2', String(element.width));
    divider.setAttribute('y1', String(headerHeight));
    divider.setAttribute('y2', String(headerHeight));
    divider.setAttribute('stroke', 'hsl(var(--border))');
    divider.setAttribute('stroke-width', '1');
    divider.setAttribute('vector-effect', 'non-scaling-stroke');
    divider.setAttribute('pointer-events', 'none');
    visual.appendChild(divider);
  }
}

/**
 * Fit every BPMN shape into its host.
 *
 * `fit-viewport` is the authoritative containment algorithm from bpmn-js. A
 * prior implementation applied a minimum scale afterwards; that made dense
 * diagrams extend beyond their host. The renderer keeps its native 14px
 * label specification; manual zoom remains available when a dense diagram is
 * physically smaller than the available canvas.
 */
export function fitBpmnToViewport(canvas: IBpmnCanvasService): void {
  canvas.zoom('fit-viewport');
}

const BPMN_WIDTH_FIT_PADDING = 32;

/**
 * Give a tall process a readable, top-aligned initial viewport.
 *
 * `fit-viewport` shrinks a long top-to-bottom process until its full height is
 * visible, which can make labels unreadable. diagram-js exposes the diagram
 * (`inner`) and host (`outer`) bounds through `Canvas.viewbox()`, so we can fit
 * the diagram width instead and expose its remaining height through the
 * viewer's native pan/navigation. Scale is capped at 1 to avoid magnifying a
 * small diagram. Invalid/empty bounds fall back to the complete fit.
 */
export function fitBpmnForVerticalBrowsing(canvas: IBpmnCanvasService): void {
  const current = canvas.viewbox();
  const { inner, outer } = current;
  if (
    inner.width <= 0 ||
    outer.width <= 0 ||
    outer.height <= 0 ||
    !Number.isFinite(inner.x) ||
    !Number.isFinite(inner.y)
  ) {
    fitBpmnToViewport(canvas);
    return;
  }

  const paddedDiagramWidth = inner.width + BPMN_WIDTH_FIT_PADDING * 2;
  const scale = Math.min(1, outer.width / paddedDiagramWidth);
  if (!Number.isFinite(scale) || scale <= 0) {
    fitBpmnToViewport(canvas);
    return;
  }

  const visibleWidth = outer.width / scale;
  const visibleHeight = outer.height / scale;
  canvas.viewbox({
    x: inner.x - (visibleWidth - inner.width) / 2,
    y: inner.y - BPMN_WIDTH_FIT_PADDING,
    width: visibleWidth,
    height: visibleHeight,
  });
}

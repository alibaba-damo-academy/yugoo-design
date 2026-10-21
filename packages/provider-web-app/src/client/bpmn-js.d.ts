/**
 * bpmn-js ships CJS `.d.ts` files whose ESM-style default exports do not
 * surface as constructable classes through NodeNext CJS interop (the default
 * import binds to the module namespace). These declarations give the two
 * entry points the panel drives a usable class shape — only the slice the
 * panel actually calls, not the full bpmn-js service graph.
 */
declare module 'bpmn-js/lib/NavigatedViewer.js' {
  /** Options subset accepted by the NavigatedViewer constructor. */
  interface BpmnViewerOptions {
    container: HTMLElement
  }
  /** Result of serialising the current diagram. */
  interface BpmnSaveXMLResult {
    xml?: string
    warnings: string[]
  }
  /** Read-only BPMN viewer with pan/zoom navigation. */
  class NavigatedViewer {
    constructor(options: BpmnViewerOptions)
    /** @param xml - BPMN 2.0 document to render. @returns import warnings. */
    importXML(xml: string): Promise<{ warnings: string[] }>
    /** @returns the serialised diagram, when serialisation succeeds. */
    saveXML(options?: { format?: boolean }): Promise<BpmnSaveXMLResult>
    /** @param name - registered service name, e.g. `canvas` or `eventBus`. */
    get(name: string): unknown
    /** Tears the viewer down and detaches it from its container. */
    destroy(): void
  }
  export default NavigatedViewer
}

declare module 'bpmn-js/lib/Modeler.js' {
  /** Options subset accepted by the Modeler constructor. */
  interface BpmnModelerOptions {
    container: HTMLElement
  }
  /** Result of serialising the current diagram. */
  interface BpmnSaveXMLResult {
    xml?: string
    warnings: string[]
  }
  /** Full BPMN modeler: drag, add, route, label. */
  class Modeler {
    constructor(options: BpmnModelerOptions)
    /** @param xml - BPMN 2.0 document to render. @returns import warnings. */
    importXML(xml: string): Promise<{ warnings: string[] }>
    /** @returns the serialised diagram, when serialisation succeeds. */
    saveXML(options?: { format?: boolean }): Promise<BpmnSaveXMLResult>
    /** @param name - registered service name, e.g. `canvas` or `eventBus`. */
    get(name: string): unknown
    /** Tears the modeler down and detaches it from its container. */
    destroy(): void
  }
  export default Modeler
}

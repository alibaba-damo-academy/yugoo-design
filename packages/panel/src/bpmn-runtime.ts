// One runtime capsule: Modeler itself imports NavigatedViewer. Keep both
// constructors behind the same boundary rather than promising separate chunks.
export { default as Modeler } from 'bpmn-js/lib/Modeler.js'
export { default as NavigatedViewer } from 'bpmn-js/lib/NavigatedViewer.js'

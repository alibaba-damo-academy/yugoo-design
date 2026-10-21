/** Stylesheet assets deliberately rendered inside a component lifetime. */
declare module '*.css?inline' {
  const content: string
  export default content
}

/** Plugin-owned stylesheet assets loaded for their side effect. */
declare module '*.css' {
}

/** Browser/server shared confinement parser; no filesystem or Host dependency. */
export function requireDesignFileRelativePath(path: string): void {
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.endsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)
    || path.split('/').some((part) => part === '' || part === '.' || part === '..' || part === '.git')) {
    throw new Error(`artifact path must stay inside design_files/: ${path}`)
  }
}

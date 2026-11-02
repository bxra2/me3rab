/**
 * Decides which theme to use.
 * @param {string|null|undefined} stored
 * @param {boolean} prefersDark
 * @returns {'light'|'dark'}
 */
export function decideTheme(stored, prefersDark) {
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

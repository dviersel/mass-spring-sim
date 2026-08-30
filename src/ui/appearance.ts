/**
 * Light, dark, or follow the system.
 *
 * The preference is stored as one of three values rather than a boolean,
 * because "follow the system" is a real choice and not the absence of one: a
 * viewer who has chosen it should track their machine switching over at dusk,
 * which a resolved light/dark flag cannot express.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'mass-spring-sim:theme'

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private windows and blocked site data both throw here. Following the
    // system is the right fallback, not an error worth surfacing.
  }
  return 'system'
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // The preference still applies for this session; it just will not persist.
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

/**
 * Stamp the choice onto the document.
 *
 * An explicit choice sets `data-theme`; following the system removes it, so the
 * stylesheet falls through to its `prefers-color-scheme` rules rather than
 * needing to be told the answer.
 */
export function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
}

/** Calls back when the system theme changes. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (query === undefined) return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

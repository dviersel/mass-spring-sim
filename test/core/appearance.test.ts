import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPreference,
  readPreference,
  resolveTheme,
  storePreference,
  systemPrefersDark,
  watchSystemTheme,
} from '../../src/ui/appearance'

/**
 * Theme preference handling, exercised without a DOM.
 *
 * The interesting cases are the ones a browser click cannot reach: storage
 * that throws, a stored value that is not a theme, and the system changing
 * underneath a viewer who chose to follow it.
 */

interface Harness {
  readonly attributes: Map<string, string>
  readonly listeners: (() => void)[]
  storage: Map<string, string> | null
  prefersDark: boolean
}

function install(overrides: Partial<Harness> = {}): Harness {
  const harness: Harness = {
    attributes: new Map(),
    listeners: [],
    storage: new Map(),
    prefersDark: false,
    ...overrides,
  }

  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => harness.attributes.set(name, value),
      removeAttribute: (name: string) => harness.attributes.delete(name),
    },
  })

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => {
        if (harness.storage === null) throw new Error('storage blocked')
        return harness.storage.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        if (harness.storage === null) throw new Error('storage blocked')
        harness.storage.set(key, value)
      },
    },
    matchMedia: (query: string) => ({
      matches: query.includes('dark') && harness.prefersDark,
      addEventListener: (_: string, fn: () => void) => harness.listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => {
        const at = harness.listeners.indexOf(fn)
        if (at >= 0) harness.listeners.splice(at, 1)
      },
    }),
  })

  return harness
}

afterEach(() => vi.unstubAllGlobals())

describe('reading the stored preference', () => {
  it('defaults to following the system', () => {
    install()
    expect(readPreference()).toBe('system')
  })

  it.each(['light', 'dark', 'system'] as const)('round-trips %s', (preference) => {
    install()
    storePreference(preference)
    expect(readPreference()).toBe(preference)
  })

  it('ignores a stored value that is not a theme', () => {
    const harness = install()
    harness.storage?.set('mass-spring-sim:theme', 'chartreuse')
    expect(readPreference()).toBe('system')
  })

  it('falls back to following the system when storage is unavailable', () => {
    // A private window or blocked site data throws on access. Following the
    // system is the right answer there, not a crash.
    install({ storage: null })
    expect(readPreference()).toBe('system')
    expect(() => storePreference('dark')).not.toThrow()
  })
})

describe('applying a preference to the document', () => {
  it('stamps an explicit choice', () => {
    const harness = install()
    applyPreference('dark')
    expect(harness.attributes.get('data-theme')).toBe('dark')
    applyPreference('light')
    expect(harness.attributes.get('data-theme')).toBe('light')
  })

  it('removes the attribute when following the system', () => {
    // The stylesheet must fall through to prefers-color-scheme rather than be
    // told an answer, otherwise it stops tracking the system entirely.
    const harness = install()
    applyPreference('dark')
    applyPreference('system')
    expect(harness.attributes.has('data-theme')).toBe(false)
  })
})

describe('resolving what to actually show', () => {
  it('honours an explicit choice regardless of the system', () => {
    install({ prefersDark: true })
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('reads the system when following it', () => {
    install({ prefersDark: true })
    expect(systemPrefersDark()).toBe(true)
    expect(resolveTheme('system')).toBe('dark')

    install({ prefersDark: false })
    expect(resolveTheme('system')).toBe('light')
  })

  it('assumes light when the browser cannot answer', () => {
    install()
    vi.stubGlobal('window', {})
    expect(systemPrefersDark()).toBe(false)
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('watching the system', () => {
  it('notifies on change and stops after unsubscribing', () => {
    const harness = install()
    const onChange = vi.fn()
    const stop = watchSystemTheme(onChange)

    expect(harness.listeners).toHaveLength(1)
    harness.listeners.forEach((fn) => fn())
    expect(onChange).toHaveBeenCalledTimes(1)

    stop()
    expect(harness.listeners).toHaveLength(0)
  })

  it('is a no-op where matchMedia is missing, rather than throwing', () => {
    install()
    vi.stubGlobal('window', {})
    const stop = watchSystemTheme(() => {})
    expect(() => stop()).not.toThrow()
  })
})

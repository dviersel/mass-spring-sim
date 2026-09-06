import { afterEach, describe, expect, it, vi } from 'vitest'
import { uniformChain, type ChainSpec } from '../../src/core/chain'
import type { PresetState } from '../../src/ui/presets'
import {
  addConfig,
  parseLibrary,
  readLibrary,
  removeConfig,
  serialiseLibrary,
  writeLibrary,
  type SavedConfig,
} from '../../src/ui/saved'

/**
 * Saved configurations, exercised without a browser.
 *
 * The interesting cases are the ones a click cannot reach: site data that
 * outlived the build that wrote it, storage that refuses to answer, and a
 * stored chain that would not survive being handed to the simulation.
 */

function install(storage: Map<string, string> | null = new Map()): Map<string, string> | null {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => {
        if (storage === null) throw new Error('storage blocked')
        return storage.get(key) ?? null
      },
      setItem: (key: string, value: string) => {
        if (storage === null) throw new Error('storage blocked')
        storage.set(key, value)
      },
    },
  })
  return storage
}

afterEach(() => vi.unstubAllGlobals())

const spec = (): ChainSpec =>
  uniformChain({
    nodeCount: 5,
    length: 1,
    totalStiffness: 100,
    totalDamping: 0.09,
    mass: 0.05,
    drivenNodes: [0, 4],
  })

const config = (name: string, state: PresetState = { spec: spec() }): SavedConfig => ({
  id: `id-${name}`,
  name,
  savedAt: '2026-09-05T00:00:00.000Z',
  state,
})

describe('saved configurations', () => {
  it('round-trips a configuration, view settings included', () => {
    const original = config('heavy middle', { spec: spec(), view: { timeScale: 0.02 } })
    const [back] = parseLibrary(serialiseLibrary([original]))

    expect(back?.name).toBe('heavy middle')
    expect(back?.state.spec.nodes).toHaveLength(5)
    expect(back?.state.view?.timeScale).toBe(0.02)
  })

  it('drops a stored chain that would not validate', () => {
    // A free node with no mass is exactly what the chain validator rejects, and
    // handing it to the simulation would throw out of a React effect.
    const broken = spec()
    const invalid: ChainSpec = {
      ...broken,
      nodes: broken.nodes.map((n, i) => (i === 2 ? { ...n, mass: 0 } : n)),
    }
    const json = serialiseLibrary([config('ok'), config('broken', { spec: invalid })])

    expect(parseLibrary(json).map((c) => c.name)).toEqual(['ok'])
  })

  it('drops everything written by a different version', () => {
    const json = JSON.stringify({ version: 999, configs: [config('from the future')] })
    expect(parseLibrary(json)).toEqual([])
  })

  it('treats unreadable storage as an empty library rather than an error', () => {
    for (const raw of [null, '', 'not json', '{}', '[]', '{"version":1}']) {
      expect(parseLibrary(raw)).toEqual([])
    }
  })

  it('reads an empty library from a browser that refuses storage', () => {
    install(null)
    expect(readLibrary()).toEqual([])
  })

  it('reports a failed write rather than pretending it saved', () => {
    // A save that silently vanishes is worse than one that says it could not.
    install(null)
    expect(writeLibrary([config('anything')])).toBe(false)
  })

  it('persists through storage and reads back', () => {
    install()
    expect(writeLibrary([config('one'), config('two')])).toBe(true)
    expect(readLibrary().map((c) => c.name)).toEqual(['one', 'two'])
  })

  it('replaces a save of the same name instead of collecting duplicates', () => {
    const first = addConfig([], 'tuned', { spec: spec() })
    const again = addConfig(first, 'tuned', { spec: spec(), view: { timeScale: 0.5 } })

    expect(again).toHaveLength(1)
    expect(again[0]?.state.view?.timeScale).toBe(0.5)
    expect(again[0]?.id).toBe(first[0]?.id)
  })

  it('keeps saves of different names, newest first', () => {
    const list = addConfig(addConfig([], 'first', { spec: spec() }), 'second', { spec: spec() })
    expect(list.map((c) => c.name)).toEqual(['second', 'first'])
  })

  it('removes by id', () => {
    const list = addConfig(addConfig([], 'a', { spec: spec() }), 'b', { spec: spec() })
    const id = list[0]?.id ?? ''
    expect(removeConfig(list, id).map((c) => c.name)).toEqual(['a'])
  })
})

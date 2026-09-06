/**
 * Configurations the user has saved, kept in browser storage.
 *
 * A saved configuration is a `PresetState` -- the very shape the built-in
 * scenarios build -- so restoring one runs the identical code path and a chain
 * the user assembled sits beside the curated ones instead of needing a parallel
 * mechanism.
 *
 * Only the configuration is stored, never the motion. Displacement and velocity
 * live in the Simulation rather than the spec, and a chain restored at rest is
 * what setting it up again means: restoring is not resuming.
 *
 * Everything read back is untrusted. Site data outlives the build that wrote
 * it, so a stored chain may be stale, hand-edited, or shaped by a version whose
 * spec differed. An entry that does not validate is dropped rather than thrown:
 * a throw on this path would come out of a React effect and unmount the whole
 * interface.
 */

import { validateChain, type ChainSpec } from '../core/chain'
import type { PresetState } from './presets'
import type { ViewSettings } from './view'

export interface SavedConfig {
  readonly id: string
  readonly name: string
  /** ISO 8601, so the list can be ordered and dated without a second field. */
  readonly savedAt: string
  readonly state: PresetState
}

const STORAGE_KEY = 'mass-spring-sim:saved'
/** Bumped when the stored shape changes. Older libraries are dropped, not migrated. */
const VERSION = 1

/**
 * Narrow one stored entry's state, or reject it.
 *
 * `validateChain` is the same gate `Simulation.setChain` uses, so anything that
 * survives here is something the simulation will accept. It is called inside a
 * try/catch because it can only inspect a value shaped roughly like a spec --
 * a stored `nodes` that is not an array throws before any check runs.
 */
function readState(value: unknown): PresetState | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { spec?: unknown; view?: unknown }
  if (typeof candidate.spec !== 'object' || candidate.spec === null) return null

  const spec = candidate.spec as ChainSpec
  try {
    if (validateChain(spec).length > 0) return null
  } catch {
    return null
  }

  if (typeof candidate.view !== 'object' || candidate.view === null) return { spec }
  return { spec, view: candidate.view as Partial<ViewSettings> }
}

function readConfig(value: unknown): SavedConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { id?: unknown; name?: unknown; savedAt?: unknown; state?: unknown }
  if (typeof candidate.id !== 'string' || candidate.id === '') return null
  if (typeof candidate.name !== 'string' || candidate.name === '') return null
  if (typeof candidate.savedAt !== 'string') return null

  const state = readState(candidate.state)
  if (state === null) return null
  return { id: candidate.id, name: candidate.name, savedAt: candidate.savedAt, state }
}

/** Every readable entry in `raw`. Anything unreadable is silently omitted. */
export function parseLibrary(raw: string | null): SavedConfig[] {
  if (raw === null || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []

  const library = parsed as { version?: unknown; configs?: unknown }
  if (library.version !== VERSION) return []
  if (!Array.isArray(library.configs)) return []

  return library.configs.flatMap((entry) => {
    const config = readConfig(entry)
    return config === null ? [] : [config]
  })
}

export function serialiseLibrary(configs: readonly SavedConfig[]): string {
  return JSON.stringify({ version: VERSION, configs })
}

export function readLibrary(): SavedConfig[] {
  try {
    return parseLibrary(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private windows and blocked site data both throw here. No saves is the
    // honest answer, and not an error worth interrupting the page for.
    return []
  }
}

/**
 * Persist the library, reporting whether it stuck.
 *
 * Unlike the theme preference, a failure here is worth surfacing: a save the
 * user asked for that silently vanished is worse than one that says it could
 * not be made.
 */
export function writeLibrary(configs: readonly SavedConfig[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, serialiseLibrary(configs))
    return true
  } catch {
    return false
  }
}

/**
 * Add a configuration under `name`, newest first.
 *
 * Saving over a name replaces that entry and keeps its id, because a slot the
 * user names twice is one slot they are revising -- collecting five saves all
 * called "chain" helps nobody.
 */
export function addConfig(
  configs: readonly SavedConfig[],
  name: string,
  state: PresetState,
): SavedConfig[] {
  const trimmed = name.trim()
  const existing = configs.find((config) => config.name === trimmed)
  const saved: SavedConfig = {
    id: existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    savedAt: new Date().toISOString(),
    state,
  }
  return [saved, ...configs.filter((config) => config.name !== trimmed)]
}

export function removeConfig(configs: readonly SavedConfig[], id: string): SavedConfig[] {
  return configs.filter((config) => config.id !== id)
}

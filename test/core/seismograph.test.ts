import { describe, expect, it } from 'vitest'
import { NodeTraceBuffer } from '../../src/ui/canvas/seismograph'

/**
 * The per-node history behind the seismograph pens. It is a ring buffer written
 * at the integration rate and read once a frame, so its bookkeeping is worth
 * pinning even though nothing about it is physics.
 */

function snapshot(values: readonly number[]): Float64Array {
  return Float64Array.from(values)
}

function collect(buffer: NodeTraceBuffer, node: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = []
  buffer.forEachNodeSample(node, (time, value) => out.push({ time, value }))
  return out
}

describe('NodeTraceBuffer', () => {
  it('replays each node oldest first', () => {
    const buffer = new NodeTraceBuffer(3, 8)
    buffer.push(0.1, snapshot([1, 10, 100]))
    buffer.push(0.2, snapshot([2, 20, 200]))
    buffer.push(0.3, snapshot([3, 30, 300]))

    expect(collect(buffer, 0).map((s) => s.value)).toEqual([1, 2, 3])
    expect(collect(buffer, 1).map((s) => s.value)).toEqual([10, 20, 30])
    expect(collect(buffer, 2).map((s) => s.value)).toEqual([100, 200, 300])
    expect(collect(buffer, 0).map((s) => s.time)).toEqual([0.1, 0.2, 0.3])
  })

  it('keeps the most recent samples once it wraps', () => {
    const buffer = new NodeTraceBuffer(2, 4)
    for (let i = 1; i <= 7; i++) buffer.push(i, snapshot([i, -i]))

    expect(buffer.size).toBe(4)
    // The four newest, still oldest first, and still paired with the right node.
    expect(collect(buffer, 0).map((s) => s.value)).toEqual([4, 5, 6, 7])
    expect(collect(buffer, 1).map((s) => s.value)).toEqual([-4, -5, -6, -7])
    expect(collect(buffer, 0).map((s) => s.time)).toEqual([4, 5, 6, 7])
  })

  it('does not confuse one node history with another after wrapping', () => {
    // A stride mistake would show up here as node 1's values leaking into
    // node 0 once the write head has passed the end.
    const nodes = 5
    const buffer = new NodeTraceBuffer(nodes, 3)
    for (let i = 0; i < 10; i++) {
      buffer.push(i, snapshot(Array.from({ length: nodes }, (_, j) => i * 100 + j)))
    }
    for (let j = 0; j < nodes; j++) {
      expect(collect(buffer, j).map((s) => s.value)).toEqual([7 * 100 + j, 8 * 100 + j, 9 * 100 + j])
    }
  })

  it('ignores a node index outside the chain rather than reading past the row', () => {
    const buffer = new NodeTraceBuffer(2, 4)
    buffer.push(0, snapshot([1, 2]))
    expect(collect(buffer, 2)).toEqual([])
    expect(collect(buffer, -1)).toEqual([])
  })

  it('reports the peak across every node inside a window', () => {
    const buffer = new NodeTraceBuffer(3, 8)
    buffer.push(1, snapshot([9, 0, 0])) // old and large
    buffer.push(2, snapshot([0, -3, 1]))
    buffer.push(3, snapshot([0, 0, 2]))

    expect(buffer.peakWithin(0)).toBe(9)
    // Dropping the old sample must drop its peak with it.
    expect(buffer.peakWithin(2)).toBe(3)
    expect(buffer.peakWithin(3)).toBe(2)
    expect(buffer.peakWithin(99)).toBe(0)
  })

  it('clears on resize, because old samples describe a different chain', () => {
    const buffer = new NodeTraceBuffer(3, 8)
    buffer.push(1, snapshot([1, 2, 3]))
    expect(buffer.size).toBe(1)

    buffer.resize(6)
    expect(buffer.nodes).toBe(6)
    expect(buffer.size).toBe(0)
    expect(collect(buffer, 5)).toEqual([])

    // And it is usable again immediately, at the new width.
    buffer.push(2, snapshot([1, 2, 3, 4, 5, 6]))
    expect(collect(buffer, 5).map((s) => s.value)).toEqual([6])
  })

  it('leaves the history alone when the size is unchanged', () => {
    const buffer = new NodeTraceBuffer(3, 8)
    buffer.push(1, snapshot([1, 2, 3]))
    buffer.resize(3)
    expect(buffer.size).toBe(1)
  })

  it('accepts a snapshot longer than the chain without corrupting the row', () => {
    // nodeDisplacements is reused across chain edits, so the array handed in can
    // be wider than the chain currently is.
    const buffer = new NodeTraceBuffer(2, 4)
    buffer.push(1, snapshot([7, 8, 9, 10]))
    expect(collect(buffer, 0).map((s) => s.value)).toEqual([7])
    expect(collect(buffer, 1).map((s) => s.value)).toEqual([8])
  })

  it('starts empty and clears back to empty', () => {
    const buffer = new NodeTraceBuffer(2, 4)
    expect(buffer.size).toBe(0)
    expect(buffer.peakWithin(0)).toBe(0)
    buffer.push(1, snapshot([1, 2]))
    buffer.clear()
    expect(buffer.size).toBe(0)
    expect(collect(buffer, 0)).toEqual([])
  })
})

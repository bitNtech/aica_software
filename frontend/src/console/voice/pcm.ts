/** 16-bit little-endian PCM, as the voice server sends and expects it
 * (docs/orchestrator-contract.md §Audio). */

/** Web Audio's floats (−1…1) as pcm16. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/** pcm16 bytes as Web Audio's floats. An odd trailing byte is dropped. */
export function pcm16ToFloat(bytes: ArrayBuffer): Float32Array {
  const n = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes, 0, n * 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

/** An operator frame: the first byte says whose audio it is. */
export function splitChannel(frame: ArrayBuffer): { channel: 'caller' | 'agent'; pcm: ArrayBuffer } {
  const bytes = new Uint8Array(frame)
  return { channel: bytes[0] === 1 ? 'caller' : 'agent', pcm: frame.slice(1) }
}

/** Joins captured chunks into one frame of at least `minSamples`. */
export class FrameBuffer {
  private parts: Int16Array[] = []
  private size = 0
  private readonly minSamples: number
  constructor(minSamples: number) {
    this.minSamples = minSamples
  }

  push(chunk: Int16Array): Int16Array | null {
    this.parts.push(chunk)
    this.size += chunk.length
    if (this.size < this.minSamples) return null
    const out = new Int16Array(this.size)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.length
    }
    this.parts = []
    this.size = 0
    return out
  }
}

/** The loudest sample in a chunk, 0…1, for a level meter. */
export function peak(input: Float32Array): number {
  let p = 0
  for (let i = 0; i < input.length; i++) p = Math.max(p, Math.abs(input[i]))
  return p
}

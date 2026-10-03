/** Pure PCM helpers for the Live API: 16 kHz 16-bit mono in, 24 kHz 16-bit mono out (little-endian). */

export const inputRate = 16_000;
export const outputRate = 24_000;

/**
 * Streaming linear resampler from the capture rate to 16 kHz. Keeps its fractional position
 * across chunks so consecutive chunks join without clicks or drift.
 */
export class Resampler {
  private pos = 0;
  private last = 0;
  constructor(private readonly from: number, private readonly to = inputRate) {}
  push(input: Float32Array): Float32Array {
    const step = this.from / this.to;
    const out: number[] = [];
    // `pos` is measured from the sample before this chunk (index -1 = this.last).
    while (this.pos < input.length - 1 + 1e-9) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : input[i]!;
      const b = input[i + 1] ?? input[i] ?? this.last;
      out.push(a + (b - a) * frac);
      this.pos += step;
    }
    this.pos -= input.length;
    if (input.length) this.last = input[input.length - 1]!;
    return Float32Array.from(out);
  }
}

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToFloat(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Root-mean-square level, 0..1, used to drive the microphone animation. */
export function level(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

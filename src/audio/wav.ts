/** 16-bit PCM WAV encoding (pure): the iOS silent loop and the render harness's output files. */

/** Interleaved channels → WAV bytes. Samples are clamped to [-1, 1]. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const nc = Math.max(1, channels.length), n = channels[0]?.length ?? 0;
  const data = n * nc * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}

/**
 * A short, effectively silent WAV (±1 LSB, about −90 dBFS) for the iOS playback-session loop: a
 * playing <audio> element moves the page's audio session to "playback", so the ring/silent switch
 * no longer mutes Web Audio.
 */
export function silentWav(seconds = 0.5, sampleRate = 8000): Uint8Array {
  const n = Math.floor(seconds * sampleRate);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (i & 1 ? 1 : -1) / 32768;
  return encodeWav([s], sampleRate);
}

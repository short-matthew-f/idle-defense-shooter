/**
 * WebGL2 instanced renderer. Consumes a RenderSnapshot only (no sim knowledge).
 *
 * Frame: counting-sort instances (+ live particles) by layer into one preallocated array, upload it
 * with a single bufferSubData, then
 *   [bloom source: layers 1-3 -> half-res FBO -> blur H/V]      (only when bloom is on)
 *   backdrop (arena floor) -> layer 0 (normal) -> layers 1-3 (additive) -> bloom composite
 *   -> layers 4-7 (normal alpha, so enemies stay legible).
 * That is at most 8 draw calls per frame regardless of entity count.
 *
 * Allocation: none per frame in the steady state. Buffers grow (reallocate) only when a snapshot
 * exceeds the current capacity.
 */
import { INSTANCE_FLOATS, type RenderSnapshot } from '@sim/core/types';
import { Bloom } from './bloom';
import type { Camera } from './camera';
import { compileProgram, uniforms, type UniformMap } from './gl-util';
import { countLayers, layerStarts, LAYER_COUNT, scatterInstances } from './layer-sort';
import { SECTOR_PALETTES, type SectorPalette } from './palette';
import { Particles, PARTICLE_BUDGET } from './particles';
import { BACKDROP_FS, FULLSCREEN_VS, INSTANCE_FS, INSTANCE_VS } from './shaders';

const BYTES_PER_INSTANCE = INSTANCE_FLOATS * 4;
const BUF_COUNT = 3;
const INITIAL_CAPACITY = 24576;

type InstU = UniformMap<'uCam' | 'uScale' | 'uOffset' | 'uPx' | 'uTime' | 'uLayerAlpha'>;
type BackU = UniformMap<'uCam' | 'uRes' | 'uOff' | 'uPx' | 'uArena' | 'uTime' | 'uBg' | 'uFloorC' | 'uFloorE' | 'uGrid' | 'uRim'>;

export interface RendererOptions {
  /** Cap on devicePixelRatio (default 2). */
  maxDpr?: number;
  /** Arena radius for the backdrop (default 520 = ARENA_RADIUS). */
  arenaRadius?: number;
  /** Disable bloom entirely (also used automatically if FBO creation fails). */
  bloom?: boolean;
}

export interface RendererStats {
  drawCalls: number;
  instances: number;
  particles: number;
  bloomHdr: boolean;
  governor: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  gl!: WebGL2RenderingContext;
  /** CSS size of the canvas as of the last resize(); use for Camera.fit. */
  cssWidth = 1;
  cssHeight = 1;
  /** Device pixel ratio actually in use (capped). */
  dpr = 1;
  maxDpr: number;
  arenaRadius: number;
  readonly stats: RendererStats = { drawCalls: 0, instances: 0, particles: 0, bloomHdr: false, governor: 1 };
  readonly particles: Particles;

  private time = 0;
  private clarity = 0;
  private clarityExplicit = false;
  private bloomEnabled: boolean;
  private lost = false;
  private lastFxTick = -1;
  private disposed = false;
  private palette: SectorPalette = SECTOR_PALETTES[0];

  // GL objects
  private instProg!: WebGLProgram;
  private backProg!: WebGLProgram;
  private instU!: InstU;
  private backU!: BackU;
  private quadBuf!: WebGLBuffer;
  private instBufs: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private emptyVao!: WebGLVertexArrayObject;
  private bloom: Bloom | null = null;
  private cur = 0;
  private lastFirst = -1;

  // CPU scratch (preallocated)
  private capacity = 0;
  private sorted = new Float32Array(0);
  private readonly counts = new Int32Array(LAYER_COUNT);
  private readonly starts = new Int32Array(LAYER_COUNT + 1);
  private readonly cursors = new Int32Array(LAYER_COUNT);
  private readonly layerAlpha = new Float32Array(LAYER_COUNT);

  private readonly onLost = (e: Event): void => { e.preventDefault(); this.lost = true; };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.initGL();
    this.resize();
  };

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxDpr = opts.maxDpr ?? 2;
    this.arenaRadius = opts.arenaRadius ?? 520;
    this.bloomEnabled = opts.bloom ?? true;
    this.particles = new Particles(PARTICLE_BUDGET);
    this.layerAlpha.fill(1);
    this.initGL();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.resize();
  }

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch { return false; }
  }

  // ---------------------------------------------------------------- setup

  private initGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is required but not available');
    this.gl = gl;

    this.instProg = compileProgram(gl, INSTANCE_VS, INSTANCE_FS, 'instance');
    this.backProg = compileProgram(gl, FULLSCREEN_VS, BACKDROP_FS, 'backdrop');
    this.instU = uniforms(gl, this.instProg, ['uCam', 'uScale', 'uOffset', 'uPx', 'uTime', 'uLayerAlpha'] as const);
    this.backU = uniforms(gl, this.backProg, ['uCam', 'uRes', 'uOff', 'uPx', 'uArena', 'uTime', 'uBg', 'uFloorC', 'uFloorE', 'uGrid', 'uRim'] as const);

    const quad = gl.createBuffer();
    const vao0 = gl.createVertexArray();
    if (!quad || !vao0) throw new Error('GL resource creation failed');
    this.quadBuf = quad;
    this.emptyVao = vao0;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.instBufs = [];
    this.vaos = [];
    this.allocInstanceBuffers(Math.max(this.capacity, INITIAL_CAPACITY));

    if (this.bloomEnabled) {
      try { this.bloom = new Bloom(gl); } catch (e) { console.warn('[render] bloom disabled:', e); this.bloom = null; }
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
  }

  /** (Re)allocate the CPU sort buffer and the GPU instance buffers for `cap` instances. */
  private allocInstanceBuffers(cap: number): void {
    const gl = this.gl;
    for (const b of this.instBufs) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    this.instBufs = [];
    this.vaos = [];
    this.capacity = cap;
    this.sorted = new Float32Array(cap * INSTANCE_FLOATS);
    for (let i = 0; i < BUF_COUNT; i++) {
      const buf = gl.createBuffer();
      const vao = gl.createVertexArray();
      if (!buf || !vao) throw new Error('GL resource creation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, cap * BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let k = 1; k <= 3; k++) {
        gl.enableVertexAttribArray(k);
        gl.vertexAttribPointer(k, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, (k - 1) * 16);
        gl.vertexAttribDivisor(k, 1);
      }
      this.instBufs.push(buf);
      this.vaos.push(vao);
    }
    gl.bindVertexArray(null);
    this.lastFirst = -1;
  }

  // ---------------------------------------------------------------- public API

  /** Match the drawing buffer to the canvas' CSS size x devicePixelRatio (capped). Call on window resize. */
  resize(): void {
    const c = this.canvas;
    const cssW = c.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 300) || 300;
    const cssH = c.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 150) || 150;
    const dpr = Math.min(this.maxDpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.dpr = dpr;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (this.bloom) {
      try { this.bloom.resize(w, h); } catch (e) { console.warn('[render] bloom disabled:', e); this.bloom.dispose(); this.bloom = null; }
    }
  }

  /** Clarity slider: 0 = Spectacle, 1 = Clarity. Overrides `snap.clarity` once called. */
  setClarity(v: number): void {
    this.clarity = v < 0 ? 0 : v > 1 ? 1 : v;
    this.clarityExplicit = true;
  }

  getClarity(): number { return this.clarity; }

  setPalette(p: SectorPalette): void { this.palette = p; }
  setSector(index: number): void {
    const i = index < 0 ? 0 : index >= SECTOR_PALETTES.length ? SECTOR_PALETTES.length - 1 : index | 0;
    this.palette = SECTOR_PALETTES[i];
  }

  setBloom(on: boolean): void { this.bloomEnabled = on; }
  get bloomOn(): boolean { return this.bloomEnabled && this.bloom !== null; }

  render(snap: RenderSnapshot, dtSeconds: number, camera: Camera): void {
    if (this.lost || this.disposed) return;
    const gl = this.gl;
    const dt = dtSeconds > 0.25 ? 0.25 : dtSeconds < 0 ? 0 : dtSeconds;
    this.time += dt;

    camera.update(dt, snap.cameraShake);
    const clarity = this.clarityExplicit ? this.clarity : (snap.clarity > 0 ? (snap.clarity > 1 ? 1 : snap.clarity) : 0);

    // --- particles
    const parts = this.particles;
    parts.emissionScale = 1 - 0.65 * clarity;
    // fx are one-shot requests: consume them once per snapshot even if the same snapshot is drawn again
    if (snap.tick !== this.lastFxTick) {
      this.lastFxTick = snap.tick;
      parts.consume(snap.fx, snap.fxCount);
    }
    parts.update(dt);

    // --- layer alpha: density governor dims player effects only; enemies/UI never dim.
    const gov = parts.governor;
    const fxA = (1 - 0.45 * clarity) * gov;
    const la = this.layerAlpha;
    la[0] = 1;
    la[1] = fxA;
    la[2] = fxA;
    la[3] = (1 - 0.3 * clarity) * (1 - (1 - gov) * 0.5); // projectiles may include enemy shots: dim half as much
    la[4] = 1; la[5] = 1; la[6] = 1; la[7] = 1;

    // --- sort + upload
    const n = snap.instanceCount;
    const total = n + parts.count;
    if (total > this.capacity) this.allocInstanceBuffers(Math.max(total + 1024, (this.capacity * 3) >> 1));
    const counts = this.counts;
    counts.fill(0);
    countLayers(snap.instances, n, counts);
    parts.countLayers(counts);
    layerStarts(counts, this.starts, this.cursors);
    scatterInstances(snap.instances, n, this.sorted, this.cursors);
    parts.scatter(this.sorted, this.cursors);

    this.cur = (this.cur + 1) % BUF_COUNT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBufs[this.cur]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sorted, 0, total * INSTANCE_FLOATS);
    gl.bindVertexArray(this.vaos[this.cur]);
    this.lastFirst = -1;

    // --- camera uniforms
    const W = this.canvas.width, H = this.canvas.height;
    const vw = camera.viewW, vh = camera.viewH;
    const s = camera.scale;
    const sx = (2 * s) / vw, sy = -(2 * s) / vh;
    const ox = (2 * (camera.centerPx - vw * 0.5)) / vw;
    const oy = (-2 * (camera.centerPy - vh * 0.5)) / vh;
    const cx = camera.x + camera.shakeX, cy = camera.y + camera.shakeY;
    const pxPerUnit = s * (W / vw);

    const st = this.starts;
    const fxFirst = st[1], fxEnd = st[4];
    const bloom = this.bloomEnabled ? this.bloom : null;
    const bloomStrength = 0.7 * (1 - 0.75 * clarity);
    const doBloom = bloom !== null && bloomStrength > 0.02 && fxEnd > fxFirst;
    const bl: Bloom | null = doBloom ? bloom : null;
    let draws = 0;

    gl.useProgram(this.instProg);
    const u = this.instU;
    gl.uniform2f(u.uCam, cx, cy);
    gl.uniform2f(u.uScale, sx, sy);
    gl.uniform2f(u.uOffset, ox, oy);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1fv(u.uLayerAlpha, la);

    // --- bloom source: additive layers into the half-res FBO, then blur
    if (bl) {
      bl.beginSource();
      gl.uniform1f(u.uPx, pxPerUnit * (bl.width / W));
      this.blendAdditive();
      this.drawRange(fxFirst, fxEnd - fxFirst);
      draws++;
      bl.blur();
      draws += 2;
      gl.useProgram(this.instProg);
      gl.bindVertexArray(this.vaos[this.cur]);
    }

    // --- main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    this.drawBackdrop(cx, cy, W, H, pxPerUnit, (camera.centerPx - vw * 0.5) * (W / vw), (camera.centerPy - vh * 0.5) * (H / vh));
    draws++;

    gl.useProgram(this.instProg);
    gl.bindVertexArray(this.vaos[this.cur]);
    this.lastFirst = -1;
    gl.uniform1f(u.uPx, pxPerUnit);

    this.blendNormal();
    if (st[1] > st[0]) { this.drawRange(st[0], st[1] - st[0]); draws++; }
    if (fxEnd > fxFirst) {
      this.blendAdditive();
      this.drawRange(fxFirst, fxEnd - fxFirst);
      draws++;
    }
    if (bl) {
      bl.composite(bloomStrength);
      draws++;
      gl.useProgram(this.instProg);
      gl.bindVertexArray(this.vaos[this.cur]);
      this.lastFirst = -1;
    }
    if (st[8] > st[4]) {
      this.blendNormal();
      this.drawRange(st[4], st[8] - st[4]);
      draws++;
    }

    const stats = this.stats;
    stats.drawCalls = draws;
    stats.instances = total;
    stats.particles = parts.count;
    stats.bloomHdr = bloom !== null && bloom.hdr;
    stats.governor = gov;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.lost) return;
    const gl = this.gl;
    for (const b of this.instBufs) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteProgram(this.instProg);
    gl.deleteProgram(this.backProg);
    this.bloom?.dispose();
    this.bloom = null;
  }

  // ---------------------------------------------------------------- internals

  private blendNormal(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private blendAdditive(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
  }

  /** Draw `count` instances starting at sorted index `first` (re-points the attribs; no baseInstance in WebGL2). */
  private drawRange(first: number, count: number): void {
    if (count <= 0) return;
    const gl = this.gl;
    if (first !== this.lastFirst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBufs[this.cur]);
      const base = first * BYTES_PER_INSTANCE;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, base);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, base + 16);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, base + 32);
      this.lastFirst = first;
    }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  private drawBackdrop(cx: number, cy: number, W: number, H: number, pxPerUnit: number, offX: number, offY: number): void {
    const gl = this.gl;
    const p = this.palette;
    const u = this.backU;
    gl.disable(gl.BLEND);
    gl.useProgram(this.backProg);
    gl.bindVertexArray(this.emptyVao);
    gl.uniform2f(u.uCam, cx, cy);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform2f(u.uOff, offX, offY);
    gl.uniform1f(u.uPx, pxPerUnit);
    gl.uniform1f(u.uArena, this.arenaRadius);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform3f(u.uBg, p.bg[0], p.bg[1], p.bg[2]);
    gl.uniform3f(u.uFloorC, p.floorCenter[0], p.floorCenter[1], p.floorCenter[2]);
    gl.uniform3f(u.uFloorE, p.floorEdge[0], p.floorEdge[1], p.floorEdge[2]);
    gl.uniform3f(u.uGrid, p.grid[0], p.grid[1], p.grid[2]);
    gl.uniform3f(u.uRim, p.rim[0], p.rim[1], p.rim[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
  }
}

/**
 * WebGL2 instanced renderer. Consumes a RenderSnapshot only (no sim knowledge).
 *
 * Frame: the CPU side lives in FramePrep (render/frame-prep.ts: cue fx, visual time, particles,
 * flag filtering, idle animation, counting sort by layer into one preallocated array), then a
 * single bufferSubData and
 *   [bloom source: layers 1-3 -> half-res FBO -> blur H/V]      (only when bloom is on)
 *   backdrop (arena floor) -> layer 0 (normal) -> layers 1-3 (additive) -> bloom composite
 *   -> layers 4-7 (normal alpha, so enemies stay legible).
 * plus an enemy knockout pass (layer-5 outlines with MIN blending before the enemy layers): at most 9 draw
 * calls per frame regardless of entity count.
 *
 * Allocation: none per frame in the steady state. Buffers grow (reallocate) only when a snapshot
 * exceeds the current capacity.
 */
import { INSTANCE_FLOATS, type RenderSnapshot } from '@sim/core/types';
import { Bloom } from './bloom';
import type { Camera } from './camera';
import { compileProgram, uniforms, type UniformMap } from './gl-util';
import { LAYER_COUNT } from './layer-sort';
import { SECTOR_PALETTES, type SectorPalette } from './palette';
import type { Particles } from './particles';
import { FramePrep, type FrameOptions } from './frame-prep';
import {
  FrameMonitor, TIERS, gfxRuntime, gfxSettings, lowerTier, minTier, motionScales, onGfxChange, reducedMotion, systemReducedMotion,
  type GfxSettings, type QualityTier,
} from './quality';
import { BACKDROP_FS, FULLSCREEN_VS, INSTANCE_FS, INSTANCE_VS } from './shaders';

const BYTES_PER_INSTANCE = INSTANCE_FLOATS * 4;
const BUF_COUNT = 3;
const INITIAL_CAPACITY = 24576;
/** Enemy bodies are drawn at least this big (CSS px radius) so they stay legible on phones. */
export const MIN_ENEMY_CSS_PX = 3.5;

type InstU = UniformMap<'uCam' | 'uScale' | 'uOffset' | 'uPx' | 'uTime' | 'uLayerAlpha' | 'uMinPx' | 'uFlash' | 'uKnock'>;
type BackU = UniformMap<'uCam' | 'uRes' | 'uOff' | 'uPx' | 'uArena' | 'uTime' | 'uBg' | 'uFloorC' | 'uFloorE' | 'uGrid' | 'uRim' | 'uMote' | 'uStyle' | 'uAmb' | 'uMotion' | 'uVig'>;
/** Where pickups fly: HUD counter icons (queried at most every PICKUP_ANCHOR_MS). */
const PICKUP_ANCHORS = ['.res-item.scrap .res-ico', '.res-item.cores .res-ico'] as const;
const PICKUP_ANCHOR_MS = 500;

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
  /** Graphics pass: effective quality tier, composite parts drawn / dropped, chain lines drawn, enemies. */
  tier: QualityTier;
  parts: number;
  partsDropped: number;
  chains: number;
  enemies: number;
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
  readonly stats: RendererStats = { drawCalls: 0, instances: 0, particles: 0, bloomHdr: false, governor: 1, tier: 'high', parts: 0, partsDropped: 0, chains: 0, enemies: 0 };
  /** CPU frame (particles, juice, sort, animation); see frame-prep.ts. */
  readonly prep = new FramePrep();
  get particles(): Particles { return this.prep.particles; }

  // graphics settings (quality.ts): chosen tier, session auto cap, derived frame options
  private gfx: GfxSettings = gfxSettings();
  private autoCap: QualityTier = 'high';
  private tier: QualityTier = 'high';
  private readonly monitor = new FrameMonitor();
  private lastFrameAt = -1;
  private readonly frameOpts: FrameOptions = { motion: motionScales(false, true), minR: 0, pxPerUnit: 0, detail: true, detailMaxEnemies: 600, chains: true, chainMax: 64, particleScale: 1, clarity: 0 };
  private ambience = 2;
  /** Visual time (FramePrep.time) for shader animation. */
  private time = 0;
  /** DPR cap from the constructor options; the tier may lower it further. */
  private readonly dprCap: number;
  private anchorAt = -1e9;
  private readonly anchorX = new Float32Array(3);
  private readonly anchorY = new Float32Array(3);
  private readonly anchorOk = new Uint8Array(3);
  private readonly unsubGfx: () => void;
  private clarity = 0;
  private clarityExplicit = false;
  private bloomEnabled: boolean;
  private lost = false;
  private disposed = false;
  private palette: SectorPalette = SECTOR_PALETTES[0];
  /** Minimum on-screen enemy radius in CSS px (see INSTANCE_VS uMinPx). */
  minEnemyPx = MIN_ENEMY_CSS_PX;
  /** UI-in-world overlay instances (tap ripple, designation reticle, aim line) drawn on layer 7. */

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

  // GPU buffer capacity (instances)
  private capacity = 0;
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
    this.dprCap = this.maxDpr;
    this.arenaRadius = opts.arenaRadius ?? 520;
    this.bloomEnabled = opts.bloom ?? true;
    this.layerAlpha.fill(1);
    this.applyGfx(this.gfx);
    this.unsubGfx = onGfxChange((g) => { this.gfx = g; this.autoCap = 'high'; this.monitor.reset(); this.applyGfx(g); this.resize(); });
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
    this.instU = uniforms(gl, this.instProg, ['uCam', 'uScale', 'uOffset', 'uPx', 'uTime', 'uLayerAlpha', 'uMinPx', 'uFlash', 'uKnock'] as const);
    this.backU = uniforms(gl, this.backProg, ['uCam', 'uRes', 'uOff', 'uPx', 'uArena', 'uTime', 'uBg', 'uFloorC', 'uFloorE', 'uGrid', 'uRim', 'uMote', 'uStyle', 'uAmb', 'uMotion', 'uVig'] as const);

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

  /** The player's Bloom preference; the Low tier turns bloom off regardless. */
  setBloom(on: boolean): void { this.bloomEnabled = on; }

  /** Extra instances for this frame (INSTANCE_FLOATS each, any layer; normally 7). Not copied: keep the buffer alive. */
  setOverlay(instances: Float32Array, count: number): void {
    this.prep.setOverlay(instances, Math.max(0, Math.min(count, Math.floor(instances.length / INSTANCE_FLOATS))));
  }
  get bloomOn(): boolean { return this.bloomEnabled && this.bloom !== null; }
  /** Effective quality tier (the chosen tier, possibly lowered for this session by auto-degrade). */
  get qualityTier(): QualityTier { return this.tier; }

  /** Derive the tier and frame options from settings (and the session's auto cap). */
  private applyGfx(g: GfxSettings): void {
    this.tier = g.auto ? minTier(g.quality, this.autoCap) : g.quality;
    const spec = TIERS[this.tier];
    const o = this.frameOpts;
    o.motion = motionScales(reducedMotion(g.motion, systemReducedMotion()), g.screenShake);
    o.detail = spec.detail; o.detailMaxEnemies = spec.detailMaxEnemies;
    o.chains = g.chainLines; o.chainMax = spec.chainMax; o.particleScale = spec.particleScale;
    this.ambience = spec.ambience;
    this.maxDpr = Math.min(this.dprCap ?? spec.maxDpr, spec.maxDpr);
    gfxRuntime.effective = this.tier;
    gfxRuntime.autoLowered = g.auto && this.tier !== g.quality;
  }

  /** Auto-degrade: feed the real rAF delta; lowers the tier for the session when frames stay long. */
  private watchFrameTime(now: number): void {
    const last = this.lastFrameAt;
    this.lastFrameAt = now;
    if (last < 0 || !this.gfx.auto) return;
    if (this.monitor.push(now - last)) {
      gfxRuntime.meanFrameMs = this.monitor.lastMean;
      if (this.tier !== 'low') {
        this.autoCap = lowerTier(this.tier);
        this.applyGfx(this.gfx);
        this.resize();
        console.info(`[render] frames averaged ${this.monitor.lastMean.toFixed(1)} ms over 2 s: quality lowered to ${this.tier} for this session`);
      }
      this.monitor.reset();
    }
  }

  /** HUD counter positions (CSS px, canvas-relative) for pickups; null when absent. */
  private refreshAnchors(now: number): void {
    if (now - this.anchorAt < PICKUP_ANCHOR_MS || typeof document === 'undefined') return;
    this.anchorAt = now;
    const cr = this.canvas.getBoundingClientRect();
    for (let k = 0; k < PICKUP_ANCHORS.length; k++) {
      const el = document.querySelector(PICKUP_ANCHORS[k]);
      const r = el ? el.getBoundingClientRect() : null;
      if (r && r.width > 0) { this.anchorX[k + 1] = r.left + r.width / 2 - cr.left; this.anchorY[k + 1] = r.top + r.height / 2 - cr.top; this.anchorOk[k + 1] = 1; }
      else this.anchorOk[k + 1] = 0;
    }
  }

  render(snap: RenderSnapshot, dtSeconds: number, camera: Camera): void {
    if (this.lost || this.disposed) return;
    const gl = this.gl;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.watchFrameTime(now);
    const dt = dtSeconds > 0.25 ? 0.25 : dtSeconds < 0 ? 0 : dtSeconds;
    const prep = this.prep, o = this.frameOpts, juice = prep.juice;

    const clarity = this.clarityExplicit ? this.clarity : (snap.clarity > 0 ? (snap.clarity > 1 ? 1 : snap.clarity) : 0);
    o.clarity = clarity;
    // camera: snapshot trauma (tower hits) and cue shake, both scaled by the Screen shake / reduced motion setting
    camera.update(dt, snap.cameraShake * o.motion.shake);
    if (juice.shake > 0) { camera.addShake(juice.shake); juice.shake = 0; }
    // the punch zoom kick lives on the camera so pointer math (camera.toWorld) matches this frame exactly
    camera.punch = juice.punch;
    const s = camera.drawScale;
    o.minR = this.minEnemyPx / Math.max(1e-6, s);
    o.pxPerUnit = s;

    // pickups fly to the HUD counters (or the tower when they are hidden)
    this.refreshAnchors(now);
    const parts = prep.particles;
    for (let k = 1; k <= 2; k++) {
      if (this.anchorOk[k]) { const w = camera.toWorld(this.anchorX[k], this.anchorY[k], this.tmpV); parts.setPickupTarget(k as 1 | 2, w.x, w.y); }
      else parts.setPickupTarget(k as 1 | 2, 0, 0);
    }

    // --- CPU frame: cues, visual time, particles, filter + animate + sort
    const total = prep.frame(snap, dt, o);
    this.time = prep.time;

    // --- layer alpha: density governor dims player effects only; enemies/UI never dim.
    const gov = parts.governor;
    const fxA = (1 - 0.6 * clarity) * gov;   // full Clarity: player effects at 40% (design §20)
    const la = this.layerAlpha;
    la[0] = 1;
    la[1] = fxA;
    la[2] = fxA;
    la[3] = (1 - 0.3 * clarity) * (1 - (1 - gov) * 0.5); // projectiles may include enemy shots: dim half as much
    la[4] = 1; la[5] = 1; la[6] = 1; la[7] = 1;

    // --- upload
    if (total > this.capacity) this.allocInstanceBuffers(Math.max(total + 1024, (this.capacity * 3) >> 1));
    this.cur = (this.cur + 1) % BUF_COUNT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBufs[this.cur]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, prep.sorted, 0, total * INSTANCE_FLOATS);
    gl.bindVertexArray(this.vaos[this.cur]);
    this.lastFirst = -1;

    // --- camera uniforms (with the punch zoom kick)
    const W = this.canvas.width, H = this.canvas.height;
    const vw = camera.viewW, vh = camera.viewH;
    const sx = (2 * s) / vw, sy = -(2 * s) / vh;
    const ox = (2 * (camera.centerPx - vw * 0.5)) / vw;
    const oy = (-2 * (camera.centerPy - vh * 0.5)) / vh;
    const cx = camera.x + camera.shakeX, cy = camera.y + camera.shakeY;
    const pxPerUnit = s * (W / vw);

    const st = prep.starts;
    const fxFirst = st[1], fxEnd = st[4];
    const bloom = this.bloomEnabled && TIERS[this.tier].bloom ? this.bloom : null;
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
    gl.uniform1f(u.uMinPx, this.minEnemyPx * (W / vw));
    gl.uniform1f(u.uFlash, o.motion.flash);
    gl.uniform1f(u.uKnock, 0);

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
    if (st[6] > st[5]) {
      // knockout: darken only what is bright around each enemy outline (MIN blend), then draw enemies on top
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MIN);
      gl.uniform1f(u.uKnock, 1);
      this.drawRange(st[5], st[6] - st[5]);
      gl.uniform1f(u.uKnock, 0);
      gl.blendEquation(gl.FUNC_ADD);
      draws++;
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
    stats.tier = this.tier;
    stats.parts = prep.partsDrawn;
    stats.partsDropped = prep.partsDropped;
    stats.chains = prep.chainsDrawn;
    stats.enemies = prep.enemies;
  }

  private readonly tmpV = { x: 0, y: 0 };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubGfx();
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
    gl.uniform3f(u.uMote, p.mote[0], p.mote[1], p.mote[2]);
    gl.uniform1f(u.uStyle, p.style);
    gl.uniform1f(u.uAmb, this.ambience);
    gl.uniform1f(u.uMotion, this.frameOpts.motion.idle > 0 ? 1 : 0.15);
    const j = this.prep.juice;
    gl.uniform4f(u.uVig, j.vr, j.vg, j.vb, j.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
  }
}

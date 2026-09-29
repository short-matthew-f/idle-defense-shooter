/**
 * One bloom pass (design §20): the additive layers (1-3) are rendered into a half-resolution
 * FBO, blurred with two separable passes (horizontal, vertical) and composited additively over
 * the frame. Never uses Canvas shadowBlur.
 *
 * Uses RGBA16F targets when the context can render to them (EXT_color_buffer_float or
 * EXT_color_buffer_half_float), otherwise falls back to RGBA8.
 */
import { compileProgram, uniforms, type UniformMap } from './gl-util';
import { BLUR_FS, COMPOSITE_FS, FULLSCREEN_VS } from './shaders';

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer }

export class Bloom {
  /** True if half-float render targets are in use (false = RGBA8 fallback). */
  hdr = false;
  width = 1;
  height = 1;

  private readonly gl: WebGL2RenderingContext;
  private readonly blurProg: WebGLProgram;
  private readonly compProg: WebGLProgram;
  private readonly blurU: UniformMap<'uTex' | 'uDir'>;
  private readonly compU: UniformMap<'uTex' | 'uStrength'>;
  private readonly vao: WebGLVertexArrayObject;
  private a: Target | null = null;
  private b: Target | null = null;
  private canHdr: boolean;
  /** Blur tap spacing multiplier; larger = wider, softer glow. */
  spread = 1.6;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.canHdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.blurProg = compileProgram(gl, FULLSCREEN_VS, BLUR_FS, 'blur');
    this.compProg = compileProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');
    this.blurU = uniforms(gl, this.blurProg, ['uTex', 'uDir'] as const);
    this.compU = uniforms(gl, this.compProg, ['uTex', 'uStrength'] as const);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.vao = vao;
  }

  resize(fullW: number, fullH: number): void {
    const w = Math.max(1, fullW >> 1);
    const h = Math.max(1, fullH >> 1);
    if (this.a && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.free();
    let t = this.canHdr ? this.makeTargets(w, h, true) : null;
    if (!t) t = this.makeTargets(w, h, false);
    if (!t) throw new Error('[render] bloom: could not create framebuffers');
    this.hdr = t.hdr;
    this.a = t.a;
    this.b = t.b;
  }

  private makeTargets(w: number, h: number, hdr: boolean): { a: Target; b: Target; hdr: boolean } | null {
    const a = this.makeTarget(w, h, hdr);
    const b = this.makeTarget(w, h, hdr);
    if (!a || !b) {
      if (a) this.freeTarget(a);
      if (b) this.freeTarget(b);
      return null;
    }
    return { a, b, hdr };
  }

  private makeTarget(w: number, h: number, hdr: boolean): Target | null {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); return null; }
    return { tex, fbo };
  }

  private freeTarget(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private free(): void {
    if (this.a) this.freeTarget(this.a);
    if (this.b) this.freeTarget(this.b);
    this.a = null;
    this.b = null;
  }

  /** Bind the half-res source target and clear it. The caller draws layers 1-3 into it. */
  beginSource(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.a!.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Two separable passes: a -> b (horizontal), b -> a (vertical). Result stays in `a`. */
  blur(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.blurProg);
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.blurU.uTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.b!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.a!.tex);
    gl.uniform2f(this.blurU.uDir, (this.spread) / this.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.a!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.b!.tex);
    gl.uniform2f(this.blurU.uDir, 0, (this.spread) / this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Additively composite the blurred result into the currently bound framebuffer (viewport set by caller). */
  composite(strength: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.compProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.a!.tex);
    gl.uniform1i(this.compU.uTex, 0);
    gl.uniform1f(this.compU.uStrength, strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.free();
    this.gl.deleteProgram(this.blurProg);
    this.gl.deleteProgram(this.compProg);
    this.gl.deleteVertexArray(this.vao);
  }
}

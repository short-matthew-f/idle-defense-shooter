/** Small WebGL helpers shared by the renderer and bloom. */

export function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string, label: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vs');
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.fs');
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`[render] link ${label}: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`[render] compile ${label}: ${log}`);
  }
  return sh;
}

export type UniformMap<K extends string> = Record<K, WebGLUniformLocation | null>;

export function uniforms<K extends string>(gl: WebGL2RenderingContext, prog: WebGLProgram, names: readonly K[]): UniformMap<K> {
  const out = {} as UniformMap<K>;
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

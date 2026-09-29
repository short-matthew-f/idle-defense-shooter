/**
 * GLSL ES 3.00 sources. Shapes are signed-distance functions evaluated in the fragment shader,
 * in radius-normalized local coordinates (shape radius = 1). Anti-aliasing uses fwidth of the
 * local coordinate, i.e. "normalized units per device pixel".
 *
 * Instance layout (3 x vec4, 48 bytes):
 *   aA = (x, y, radius, rotation)
 *   aB = (shape, r, g, b)
 *   aC = (alpha, layer, aux0, aux1)
 * Shape ids match `Shape` in src/sim/core/types.ts.
 */

/** Generates an iq-style exact polygon SDF over a constant vertex array. */
function polyFn(name: string, verts: readonly (readonly [number, number])[]): string {
  const n = verts.length;
  const list = verts.map(([x, y]) => `vec2(${x.toFixed(5)}, ${y.toFixed(5)})`).join(',\n    ');
  return `
const vec2 ${name}_V[${n}] = vec2[${n}](
    ${list}
);
float ${name}(vec2 p) {
  float d = dot(p - ${name}_V[0], p - ${name}_V[0]);
  float s = 1.0;
  for (int i = 0, j = ${n - 1}; i < ${n}; j = i, i++) {
    vec2 e = ${name}_V[j] - ${name}_V[i];
    vec2 w = p - ${name}_V[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= ${name}_V[i].y, p.y < ${name}_V[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}`;
}

const STAR_VERTS: [number, number][] = (() => {
  const v: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 1.0 : 0.46;
    v.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return v;
})();
const SHARD_VERTS: [number, number][] = [[1.0, 0.0], [-0.15, 0.36], [-0.95, 0.0], [-0.15, -0.36]];

export const INSTANCE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;
layout(location = 3) in vec4 aC;

uniform vec2 uCam;        // world point at the arena center of the view (includes shake)
uniform vec2 uScale;      // NDC per world unit (x, y), y already flipped for y-down world
uniform vec2 uOffset;     // NDC offset of the view center (UI insets)
uniform float uPx;        // device pixels per world unit
uniform float uTime;
uniform float uLayerAlpha[8];
uniform float uMinPx;     // minimum enemy body radius in device pixels (phone legibility)

out vec2 vP;              // local coords, radius-normalized, shape frame
out vec2 vU;              // local coords, radius-normalized, world-aligned (for hp bars)
flat out vec4 vColor;
flat out vec4 vInfo;      // shape, layer, aux0, line half-length

void main() {
  float shape = aB.x;
  float layerF = aC.y;
  int li = int(layerF + 0.5);
  float alpha = aC.x * uLayerAlpha[li];
  float r = aA.z;
  vec2 c = aA.xy;
  float rot = aA.w;

  // Enemies never shrink below uMinPx on screen (a swarmer is ~1 px on a phone otherwise); the
  // outline keeps its 2-unit gap and the halo its 1.8x ratio around the enlarged body.
  float m = uMinPx / uPx;
  if (li == 4) r = max(r, m);
  else if (li == 5) r = max(r, m + 2.0);
  else if (li == 6) r = max(r, m * 1.8);

  if (li == 6) {
    // threat halos pulse
    float ph = fract(sin(dot(aA.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
    float s = 0.5 + 0.5 * sin(uTime * 5.0 + ph);
    alpha *= 0.4 + 0.6 * s;
    r *= 1.0 + 0.14 * s;
  }

  r = max(r, 1.25 / uPx);
  float pad = li == 4 ? 1.7 : (li == 5 ? 1.4 : 1.25);
  vec2 ext = vec2(pad);
  float hl = 0.0;
  if (shape > 7.5 && shape < 8.5) {
    vec2 d = aC.zw - aA.xy;
    float len = length(d);
    c = aA.xy + 0.5 * d;
    rot = len > 1e-4 ? atan(d.y, d.x) : 0.0;
    hl = 0.5 * len / r;
    ext = vec2(hl + pad, pad);
  }
  vec2 local = aQuad * ext;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 rotated = vec2(cs * local.x - sn * local.y, sn * local.x + cs * local.y);
  vec2 world = c + rotated * r;
  gl_Position = vec4((world - uCam) * uScale + uOffset, 0.0, 1.0);
  vP = local;
  vU = rotated;
  vColor = vec4(aB.yzw, alpha);
  vInfo = vec4(shape, layerF, aC.z, hl);
}
`;

export const INSTANCE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec2 vU;
flat in vec4 vColor;
flat in vec4 vInfo;
out vec4 outColor;

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// regular n-gon, circumradius r, one vertex on +x
float sdNgon(vec2 p, float n, float r) {
  float an = 3.14159265 / n;
  float bn = mod(atan(p.y, p.x), 2.0 * an) - an;
  return length(p) * cos(bn) - r * cos(an);
}
${polyFn('sdStar', STAR_VERTS)}
${polyFn('sdShard', SHARD_VERTS)}

float shapeSd(int shape, vec2 p, float hl, float aux0, float px) {
  if (shape == 0) return length(p) - 1.0;
  if (shape == 1) {
    float hw = aux0 > 0.0 ? clamp(aux0 * 0.5, 0.0, 0.5) : clamp(1.25 * px, 0.012, 0.3);
    return abs(length(p) - (1.0 - hw)) - hw;
  }
  if (shape == 2) return sdNgon(p, 3.0, 1.0);
  if (shape == 3) return sdBox(p, vec2(0.78));
  if (shape == 4) return (abs(p.x) + abs(p.y) - 1.0) * 0.70710678;
  if (shape == 5) return sdNgon(p, 6.0, 1.0);
  if (shape == 6) return sdStar(p);
  if (shape == 7) return length(p - vec2(clamp(p.x, -0.55, 0.55), 0.0)) - 0.45;
  if (shape == 8) return length(p - vec2(clamp(p.x, -hl, hl), 0.0)) - 1.0;
  if (shape == 9) return sdShard(p);
  if (shape == 10) return min(sdBox(p, vec2(1.0, 0.3)), sdBox(p, vec2(0.3, 1.0)));
  return max(length(p) - 1.0, -(length(p - vec2(0.42, 0.0)) - 0.78));
}

void main() {
  int shape = int(vInfo.x + 0.5);
  int layer = int(vInfo.y + 0.5);
  vec2 dp = fwidth(vP);
  float px = max(max(dp.x, dp.y), 1e-5);   // normalized units per device pixel
  float d = shapeSd(shape, vP, vInfo.w, vInfo.z, px);

  vec3 col = vColor.rgb;
  float cov;
  if (layer == 5) {
    // enemy outline: a ~2px band just outside the body, whatever the shape
    float w = 2.0 * px;
    float band = abs(d - 0.5 * w) - 0.5 * w;
    cov = clamp(0.5 - band / px, 0.0, 1.0);
  } else if (layer == 6) {
    // threat halo: soft glow hugging the outside of the silhouette
    cov = smoothstep(-0.5, -0.05, d) * (1.0 - smoothstep(0.0, 0.2, d));
  } else {
    cov = clamp(0.5 - d / px, 0.0, 1.0);
    if (layer == 4) {
      // bevel: slightly darker interior, lighter rim so silhouettes pop
      float rim = smoothstep(-0.28, -0.04, d);
      col = mix(col * 0.82, min(col * 1.3 + 0.07, vec3(1.0)), rim);
    } else if (layer == 1 && shape == 0) {
      // hazard zone: faint fill with a defined rim
      cov *= 0.3 + 0.7 * smoothstep(-0.22, -0.02, d);
    } else if (layer == 2 || layer == 3) {
      // white-hot core for glowing player effects
      float core = 1.0 - smoothstep(-1.0, -0.3, d);
      col = mix(col, vec3(1.0), 0.3 * core);
    }
  }

  float a = vColor.a * cov;
  vec3 rgb = col;

  if (layer == 4 && vInfo.z > 0.0 && vInfo.z < 0.999) {
    // hp bar under the body in world-aligned space
    vec2 bp = vU - vec2(0.0, 1.32);
    float hb = max(0.1, 1.6 * px);
    float bw = 0.85;
    float bd = sdBox(bp, vec2(bw, hb));
    float track = clamp(0.5 - bd / px, 0.0, 1.0);
    float fillX = -bw + 2.0 * bw * vInfo.z;
    float fillD = sdBox(bp - vec2(0.5 * (fillX - bw), 0.0), vec2(0.5 * (fillX + bw), hb));
    float fill = clamp(0.5 - fillD / px, 0.0, 1.0);
    vec3 fillCol = mix(vec3(1.0, 0.36, 0.3), vec3(0.95, 0.98, 1.0), vInfo.z);
    float ta = track * 0.78;
    vec3 barCol = mix(vec3(0.03, 0.03, 0.05), fillCol, fill);
    float ba = max(ta, fill);
    float oa = a + ba * (1.0 - a);
    rgb = (col * a + barCol * ba * (1.0 - a)) / max(oa, 1e-4);
    a = oa;
  }

  if (a < 0.004) discard;
  outColor = vec4(rgb, a);
}
`;

/** Fullscreen triangle from gl_VertexID (no vertex buffers). */
export const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BACKDROP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uCam;
uniform vec2 uRes;       // device px
uniform vec2 uOff;       // device px offset of the arena center from the canvas center (y down)
uniform float uPx;       // device px per world unit
uniform float uArena;
uniform float uTime;
uniform vec3 uBg;
uniform vec3 uFloorC;
uniform vec3 uFloorE;
uniform vec3 uGrid;
uniform vec3 uRim;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 f = gl_FragCoord.xy;
  vec2 sp = vec2(f.x - 0.5 * uRes.x, 0.5 * uRes.y - f.y) - uOff;
  vec2 wp = sp / uPx + uCam;
  float dist = length(wp);
  float aa = 1.0 / uPx;                      // world units per pixel
  float R = uArena;
  float inside = 1.0 - smoothstep(R - aa, R + aa, dist);

  vec3 floorCol = mix(uFloorC, uFloorE, smoothstep(0.0, R, dist));

  float spacing = 80.0;
  float rd = abs(fract(dist / spacing + 0.5) - 0.5) * spacing;
  float ringLine = clamp(1.0 - rd / (1.2 * aa), 0.0, 1.0) * (1.0 - 0.6 * dist / R);
  float spokeW = 6.2831853 / 24.0;
  float ang = atan(wp.y, wp.x);
  float sd = abs(fract(ang / spokeW + 0.5) - 0.5) * spokeW * dist;
  float spoke = clamp(1.0 - sd / (1.2 * aa), 0.0, 1.0) * smoothstep(30.0, 120.0, dist) * 0.55;

  float sweepR = fract(uTime / 7.0) * R;
  float sweep = exp(-abs(dist - sweepR) / 7.0) * (1.0 - sweepR / R) * 0.12;

  float rimD = abs(dist - R);
  float rimLine = clamp(1.0 - rimD / (1.6 * aa), 0.0, 1.0);
  float rimGlow = exp(-rimD / 16.0) * 0.28;

  vec3 col = mix(uBg, floorCol, inside);
  col += uGrid * (ringLine * 0.5 + spoke * 0.3 + sweep) * inside;
  col += uRim * (rimLine * 0.85 + rimGlow);
  col += (hash(f) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;

/** 9-tap gaussian using 5 bilinear fetches. uDir = texel step along the blur axis. */
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  c += (texture(uTex, vUv + o1) + texture(uTex, vUv - o1)) * 0.3162162162;
  c += (texture(uTex, vUv + o2) + texture(uTex, vUv - o2)) * 0.0702702703;
  outColor = c;
}
`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uStrength;
void main() {
  outColor = vec4(texture(uTex, vUv).rgb * uStrength, 1.0);
}
`;

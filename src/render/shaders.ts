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
uniform float uFlash;     // alpha scale for Flash-flagged instances (reduced motion)

out vec2 vP;              // local coords, radius-normalized, shape frame
out vec2 vU;              // local coords, radius-normalized, world-aligned (for hp bars)
flat out vec4 vColor;
flat out vec4 vInfo;      // shape, layer, aux0, line half-length
flat out vec3 vExtra;     // flags, body status bits, phase 0..1

void main() {
  float shape = aB.x;
  int L = int(aC.y + 0.5);
  int li = L & 7;
  int fl = L >> 3;
  float alpha = aC.x * uLayerAlpha[li];
  if ((fl & 8) != 0) alpha *= uFlash;
  float r = aA.z;
  vec2 c = aA.xy;
  float rot = aA.w;

  if (fl == 0) {
    // Enemies never shrink below uMinPx on screen (a swarmer is ~1 px on a phone otherwise); the
    // outline keeps its 2-unit gap and the halo its 1.8x ratio around the enlarged body. Composite
    // parts get the same enlargement on the CPU (render/frame-prep.ts).
    float m = uMinPx / uPx;
    if (li == 4) r = max(r, m);
    else if (li == 5) r = max(r, m + 2.0);
    else if (li == 6) r = max(r, m * 1.8);
    if (li == 6) {
      // threat halos pulse (~0.8 Hz)
      float ph = fract(sin(dot(aA.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      float s = 0.5 + 0.5 * sin(uTime * 5.0 + ph);
      alpha *= 0.4 + 0.6 * s;
      r *= 1.0 + 0.14 * s;
    }
  }

  r = max(r, 1.25 / uPx);
  // outlines reserve ~9 device px outside the body for the knockout shadow (FS layer 5)
  float pad = (li == 4 && fl == 0) ? 1.7 : (li == 5 && fl == 0 ? max(1.4, 1.0 + 9.0 / max(r * uPx, 1.0)) : 1.25);
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
  vInfo = vec4(shape, float(li), aC.z, hl);
  float st = 0.0, ph = 0.0;
  if (fl == 0 && li == 4 && !(shape > 7.5 && shape < 8.5)) {
    int packed = int(aC.w + 0.5);
    st = float(packed & 255);
    ph = float((packed >> 8) & 63) / 64.0;
  }
  vExtra = vec3(float(fl), st, ph);
}
`;

export const INSTANCE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec2 vU;
flat in vec4 vColor;
flat in vec4 vInfo;
flat in vec3 vExtra;
uniform float uTime;
uniform float uKnock;     // 1 = knockout pass (MIN blending, outlines only)
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
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// teardrop along x: round end at x = -0.45 (r 0.55), point at x = +0.85
float sdDrop(vec2 p) {
  vec2 q = vec2(abs(p.y), p.x + 0.45);
  const float r1 = 0.55, r2 = 0.06, h = 1.3;
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(q, vec2(-b, a));
  if (k < 0.0) return length(q) - r1;
  if (k > a * h) return length(q - vec2(0.0, h)) - r2;
  return dot(q, vec2(a, b)) - r1;
}
${polyFn('sdStar', STAR_VERTS)}
${polyFn('sdShard', SHARD_VERTS)}

float ringHw(float aux0, float px) { return aux0 > 0.0 ? clamp(aux0 * 0.5, 0.0, 0.5) : clamp(1.25 * px, 0.012, 0.3); }

float shapeSd(int shape, vec2 p, float hl, float aux0, float px) {
  if (shape == 0) return length(p) - 1.0;
  if (shape == 1) {
    float hw = ringHw(aux0, px);
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
  if (shape == 11) return max(length(p) - 1.0, -(length(p - vec2(0.42, 0.0)) - 0.78));
  if (shape == 12) return sdNgon(p, 5.0, 1.0);
  if (shape == 13) return sdNgon(p, 8.0, 1.0);
  if (shape == 14) {
    vec2 q = vec2(p.x, abs(p.y));
    return sdSeg(q, vec2(-0.55, 0.72), vec2(0.6, 0.0)) - 0.24;
  }
  if (shape == 15) {
    // 90-degree ring segment centred on +x
    float hw = ringHw(aux0, px);
    float ra = 1.0 - hw;
    vec2 q = vec2(abs(p.y), p.x);
    const vec2 sc = vec2(0.70710678, 0.70710678);
    return ((sc.y * q.x > sc.x * q.y) ? length(q - sc * ra) : abs(length(q) - ra)) - hw;
  }
  if (shape == 16) {
    // cog: 8 teeth
    float a = atan(p.y, p.x);
    float teeth = smoothstep(-0.25, 0.25, cos(a * 8.0));
    return (length(p) - (0.8 + 0.2 * teeth)) * 0.8;
  }
  return sdDrop(p);
}

float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Statuses on the body, by pattern and motion (never hue alone): ice facets, frost speckle at the rim,
// flames travelling the rim, rising bubbles, crackling bolts (re-rolled 3x/s), drips, cracks.
vec3 statusShade(vec3 col, int st, float d, vec2 u, float px, float ph) {
  float rim = smoothstep(-0.34, -0.02, d);
  if ((st & 4) != 0) {
    col = mix(col, vec3(0.78, 0.94, 1.0), 0.5);
    float f = abs(fract(u.x * 1.7 + u.y * 1.1 + 0.3) - 0.5);
    float g = abs(fract(-u.x * 1.3 + u.y * 1.6) - 0.5);
    col = mix(col, vec3(1.0), 0.65 * (1.0 - smoothstep(0.0, 0.07 + px, min(f, g))));
  } else if ((st & 2) != 0) {
    float n = hash2(floor(u * 7.0));
    col = mix(col, vec3(0.86, 0.97, 1.0), rim * step(0.45, n) * 0.9);
  }
  if ((st & 1) != 0) {
    float a = atan(u.y, u.x);
    float fl = 0.5 + 0.5 * sin(a * 5.0 - uTime * 5.0 + ph * 6.2831853);
    float up = smoothstep(0.4, -0.9, u.y);
    col = mix(col, vec3(1.0, 0.48, 0.08), rim * (0.3 + 0.7 * fl) * (0.45 + 0.55 * up));
  }
  if ((st & 8) != 0) {
    vec2 q = u * 3.0 + vec2(ph * 5.0, uTime * 0.9);
    vec2 cc = fract(q) - 0.5;
    float cell = hash2(floor(q));
    float b = abs(length(cc) - 0.12 - 0.14 * cell);
    col = mix(col, vec3(0.2, 0.9, 0.35), (1.0 - smoothstep(0.0, 0.05 + px, b)) * step(0.3, cell));
  }
  if ((st & 16) != 0) {
    float seed = floor(uTime * 3.0) + ph * 17.0;
    float zig = abs(fract(u.x * 2.2 + hash1(seed)) - 0.5) * 0.7;
    float yl = (hash1(seed + 3.0) - 0.5) * 0.9;
    float bolt = 1.0 - smoothstep(0.0, 0.06 + px, abs(u.y - yl - zig + 0.17));
    col = mix(col, vec3(1.0, 0.98, 0.62), bolt);
  }
  if ((st & 32) != 0) {
    float xc = floor(u.x * 4.0);
    float len = 0.25 + 0.55 * hash1(xc + ph * 9.0);
    float drip = step(abs(fract(u.x * 4.0) - 0.5), 0.16) * step(1.0 - len, u.y);
    col = mix(col, vec3(0.5, 0.02, 0.06), drip * 0.85);
  }
  if ((st & 64) != 0) {
    float c1 = abs(dot(u, vec2(0.8, 0.6)) - 0.1);
    float c2 = abs(dot(u - vec2(0.15, 0.0), vec2(-0.49, 0.87))) + (u.x < 0.0 ? 9.0 : 0.0);
    float c3 = abs(dot(u + vec2(0.1, 0.3), vec2(0.96, -0.28))) + (u.y > -0.1 ? 9.0 : 0.0);
    float crk = 1.0 - smoothstep(0.0, 0.04 + px, min(c1, min(c2, c3)));
    col = mix(col, vec3(0.04, 0.03, 0.05), crk * 0.9);
  }
  return col;
}

void main() {
  int shape = int(vInfo.x + 0.5);
  int layer = int(vInfo.y + 0.5);
  int fl = int(vExtra.x + 0.5);
  vec2 dp = fwidth(vP);
  float px = max(max(dp.x, dp.y), 1e-5);   // normalized units per device pixel
  float d = shapeSd(shape, vP, vInfo.w, vInfo.z, px);

  vec3 col = vColor.rgb;
  float cov;
  if (uKnock > 0.5) {
    // knockout pass (MIN blending, before the bodies): whatever is BRIGHT around an enemy (a blast, a beam,
    // bloom) is pulled down to near-black within a few px of its outline; a dark floor is left as it is.
    // So enemies separate from player effects without a halo on the plain floor, and never dim themselves.
    if (layer != 5 || fl != 0) discard;
    float w = 2.0 * px;
    float sw = clamp(0.55 / px, 2.2, 5.5);
    float k = smoothstep(w, w + sw * px, d);
    if (k > 0.999) discard;
    outColor = vec4(vec3(mix(0.1, 1.0, k)), 1.0);
    return;
  }
  if (layer == 5 && fl == 0) {
    // enemy outline: a band just outside the body, whatever the shape (2 px, thinner on tiny phone bodies)
    float w = clamp(0.35 / px, 1.3, 2.0) * px;
    float band = abs(d - 0.5 * w) - 0.5 * w;
    cov = clamp(0.5 - band / px, 0.0, 1.0);
  } else if (layer == 6 && fl == 0) {
    // threat halo: soft glow hugging the outside of the silhouette
    cov = smoothstep(-0.5, -0.05, d) * (1.0 - smoothstep(0.0, 0.2, d));
  } else if ((fl & 16) != 0) {
    // soft glow disc (elite aura, burrow dust)
    float k = clamp(-d, 0.0, 1.0);
    cov = k * k;
  } else {
    cov = clamp(0.5 - d / px, 0.0, 1.0);
    if (layer == 4) {
      if (fl == 0) {
        // body bevel: slightly darker interior, a bright rim so silhouettes pop against the dark outline
        float rim = smoothstep(-0.34, -0.04, d);
        col = mix(col * 0.85, min(col * 1.35 + 0.12, vec3(1.0)), rim);
        int st = int(vExtra.y + 0.5);
        if (st != 0) col = statusShade(col, st, d, vU, px, vExtra.z);
      } else if ((fl & 8) == 0) {
        // composite part: bevel plus a dark ~1.3 px edge so parts separate from the body and the floor
        // (no edge on parts under ~4 px, where it would swallow the part)
        float rim = smoothstep(-0.3, -0.05, d);
        col = mix(col * 0.85, min(col * 1.2 + 0.05, vec3(1.0)), rim);
        float edge = smoothstep(-2.3 * px, -1.0 * px, d) * smoothstep(0.35, 0.22, px);
        col = mix(col, col * 0.18, edge * 0.85);
      }
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

  if (layer == 4 && fl == 0 && vInfo.z > 0.0 && vInfo.z < 0.999) {
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

/**
 * Arena floor with per-Sector ambience (graphics pass). uStyle picks the grid: 0 Outskirts rings + spokes,
 * 1 Hive honeycomb, 2 Bastion Line plate grid + ticked rings, 3 Fold warped rings, 4 Court double rings +
 * filigree. uAmb: 0 grid only (Low), 1 grid + sweep, 2 grid + sweep + drifting parallax motes. uVig: floor-only
 * vignette pulse (rgb, alpha ≤ 0.22); enemies are drawn later and never dim.
 */
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
uniform vec3 uMote;
uniform float uStyle;
uniform float uAmb;
uniform float uMotion;
uniform vec4 uVig;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float lineAA(float dist, float aa) { return clamp(1.0 - dist / (1.2 * aa), 0.0, 1.0); }

// distance to the nearest edge of a hex cell grid (pointy-top), cell radius s
float hexEdge(vec2 p, float s) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p / s, r) - h;
  vec2 b = mod(p / s - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return (0.5 - max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x)) * s;
}

// one layer of drifting motes; returns brightness
float motes(vec2 wp, float cell, float seed, float t) {
  vec2 c = floor(wp / cell);
  vec2 f = wp / cell - c;
  float h = hash(c + seed);
  vec2 pos = vec2(0.2 + 0.6 * hash(c + seed + 1.7), 0.2 + 0.6 * hash(c + seed + 3.1));
  float d = length(f - pos) * cell;
  float tw = 0.55 + 0.45 * sin(t * (0.6 + h) + h * 40.0);
  return step(0.55, h) * tw * smoothstep(1.8, 0.2, d);
}

void main() {
  vec2 f = gl_FragCoord.xy;
  vec2 sp = vec2(f.x - 0.5 * uRes.x, 0.5 * uRes.y - f.y) - uOff;
  vec2 wp = sp / uPx + uCam;
  float dist = length(wp);
  float aa = 1.0 / uPx;                      // world units per pixel
  float R = uArena;
  float inside = 1.0 - smoothstep(R - aa, R + aa, dist);
  float t = uTime * uMotion;

  vec3 floorCol = mix(uFloorC, uFloorE, smoothstep(0.0, R, dist));
  float ang = atan(wp.y, wp.x);
  int style = int(uStyle + 0.5);
  float grid = 0.0;
  {
    float fade = 1.0 - 0.6 * dist / R;
    if (style == 1) {
      float he = hexEdge(wp, 46.0);
      grid = lineAA(abs(he), aa) * 0.42 * fade;
      grid += lineAA(abs(fract(dist / 160.0 + 0.5) - 0.5) * 160.0, aa) * 0.3 * fade;
    } else if (style == 2) {
      vec2 g = abs(fract(wp / 64.0 + 0.5) - 0.5) * 64.0;
      grid = lineAA(min(g.x, g.y), aa) * 0.5 * fade;
      float rd = abs(fract(dist / 120.0 + 0.5) - 0.5) * 120.0;
      float tick = step(abs(fract(ang / (6.2831853 / 48.0) + 0.5) - 0.5), 0.12);
      grid += lineAA(rd, aa) * 0.7 * fade + lineAA(max(rd - 4.0, 0.0), aa) * tick * 0.6 * fade;
    } else if (style == 3) {
      float wd = dist + 7.0 * sin(ang * 6.0 + dist * 0.021 + t * 0.25) + 4.0 * sin(ang * 11.0 - t * 0.17);
      float rd = abs(fract(wd / 70.0 + 0.5) - 0.5) * 70.0;
      grid = lineAA(rd, aa * 1.4) * 0.6 * fade;
    } else if (style == 4) {
      float rd = abs(fract(dist / 96.0 + 0.5) - 0.5) * 96.0;
      grid = (lineAA(rd, aa) + lineAA(abs(rd - 5.0), aa) * 0.7) * 0.55 * fade;
      float spokeW = 6.2831853 / 12.0;
      float sd = abs(fract(ang / spokeW + 0.5) - 0.5) * spokeW * dist;
      float fil = abs(fract(ang / spokeW * 2.0 + dist / 96.0) - 0.5) * spokeW * dist * 0.5;
      grid += lineAA(sd, aa) * smoothstep(40.0, 140.0, dist) * 0.4 + lineAA(fil, aa) * smoothstep(60.0, 200.0, dist) * 0.18;
    } else {
      float rd = abs(fract(dist / 80.0 + 0.5) - 0.5) * 80.0;
      grid = lineAA(rd, aa) * 0.5 * fade;
      float spokeW = 6.2831853 / 24.0;
      float sd = abs(fract(ang / spokeW + 0.5) - 0.5) * spokeW * dist;
      grid += lineAA(sd, aa) * smoothstep(30.0, 120.0, dist) * 0.165;
    }
  }

  float sweep = 0.0;
  if (uAmb > 0.5) {
    float sweepR = fract(uTime / 7.0) * R;
    sweep = exp(-abs(dist - sweepR) / 7.0) * (1.0 - sweepR / R) * 0.12 * uMotion;
  }

  float rimD = abs(dist - R);
  float rimLine = lineAA(rimD, aa * 1.33);
  if (style == 2) rimLine *= 0.55 + 0.45 * step(0.5, fract(ang / (6.2831853 / 72.0)));   // crenellated rim
  if (style == 4) rimLine += lineAA(abs(dist - R + 7.0), aa) * 0.6;                        // double rim
  float rimGlow = exp(-rimD / 16.0) * 0.28;

  vec3 col = mix(uBg, floorCol, inside);
  col += uGrid * (grid + sweep) * inside;
  col += uRim * (rimLine * 0.85 + rimGlow);

  if (uAmb > 1.5) {
    // two parallax layers of motes: they drift, and slide against the camera when it pans
    vec2 drift = vec2(t * 3.0, -t * 1.6);
    float m1 = motes(wp * 0.9 - uCam * 0.25 + drift, 70.0, 1.0, t);
    float m2 = motes(wp * 0.7 - uCam * 0.5 + drift * 0.5, 110.0, 7.0, t);
    col += uMote * (m1 * 0.16 + m2 * 0.1) * (0.4 + 0.6 * inside);
  }

  // screen vignette: static edge darkening plus the cue pulse (floor only)
  vec2 uv = f / uRes - 0.5;
  float edge = smoothstep(0.35, 0.95, length(uv * vec2(uRes.x / max(uRes.y, 1.0), 1.0)) * 1.1);
  col *= 1.0 - 0.28 * edge;
  col += uVig.rgb * uVig.a * (0.35 + 0.65 * edge);

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

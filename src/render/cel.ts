/**
 * Cel pipeline: banded toon shading + rim light + optional hard specular, and
 * inverted-hull outlines with a (distance-attenuated) constant pixel width.
 *
 * Every solid surface in the game goes through `cel()` — that is what keeps the
 * look coherent. Materials are cached by key so a forest of palms costs one
 * material, not hundreds.
 */

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  type ColorRepresentation,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  type Side,
  Texture,
  UnsignedByteType,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three';

/**
 * Anime / toon ramp: a bright lit band, a soft half-tone just past the
 * terminator and a light shadow band. The shadow never goes near black — the
 * hemisphere light fills it with the sky's colour, so shadows read as tinted.
 */
let ramp: DataTexture | null = null;
function toonRamp(): Texture {
  if (ramp) return ramp;
  ramp = new DataTexture(new Uint8Array([140, 140, 200, 255, 255, 255]), 6, 1, RedFormat, UnsignedByteType);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}
/** Outlines are thinner than the old ink: the style wants soft, tinted lines. */
const OUTLINE_THIN = 0.8;

/** Uniforms shared by every cel material — updated once per frame by the renderer. */
export const celShared = {
  uRimColor: { value: new Color(0xffffff) },
  uRim: { value: 0.35 },
  uSunView: { value: new Vector3(0, 1, 0) },
  uSpecColor: { value: new Color(0xffffff) },
  uResolution: { value: new Vector2(1920, 1080) },
  uOutlineColor: { value: new Color(0x23406a) },
  uOutlineScale: { value: 1 },
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export interface CelOptions {
  color?: ColorRepresentation;
  map?: Texture | null;
  emissive?: ColorRepresentation;
  emissiveIntensity?: number;
  /** Hard specular highlight (glossy paint, wet rock). 0 = off. */
  gloss?: number;
  rim?: number;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: Side;
  /** Vertex sway strength for foliage (scaled by height²). */
  wind?: number;
  flatShading?: boolean;
  fog?: boolean;
}

const matCache = new Map<string, MeshToonMaterial>();

export function cel(key: string, o: CelOptions = {}): MeshToonMaterial {
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = makeCel(o);
  matCache.set(key, m);
  return m;
}

/** Uncached cel material (for per-instance textures such as liveries). */
export function makeCel(o: CelOptions = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    gradientMap: toonRamp(),
    emissive: new Color(o.emissive ?? 0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    vertexColors: !!o.vertexColors,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    fog: o.fog ?? true,
  });
  if (o.side !== undefined) m.side = o.side;
  const gloss = o.gloss ?? 0;
  const rim = o.rim ?? 1;
  const wind = o.wind ?? 0;
  m.onBeforeCompile = (shader) => {
    if (wind > 0) {
      shader.uniforms.uTime = celShared.uTime;
      shader.uniforms.uWind = celShared.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  vec3 base = vec3(0.0);
  #ifdef USE_INSTANCING
    base = instanceMatrix[3].xyz;
  #endif
  float hh = max(transformed.y, 0.0);
  float sw = sin(uTime * 1.3 + base.x * 0.05 + base.z * 0.07) * 0.6 + sin(uTime * 2.9 + base.x * 0.13) * 0.25;
  transformed.x += sw * hh * hh * ${wind.toFixed(4)} * uWind;
  transformed.z += sw * 0.6 * hh * hh * ${wind.toFixed(4)} * uWind;
}`,
        );
    }
    shader.uniforms.uRimColor = celShared.uRimColor;
    shader.uniforms.uRim = celShared.uRim;
    shader.uniforms.uSunView = celShared.uSunView;
    shader.uniforms.uSpecColor = celShared.uSpecColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRimColor;
uniform float uRim;
uniform vec3 uSunView;
uniform vec3 uSpecColor;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 Vd = normalize(vViewPosition);
  float ndv = clamp(dot(normal, Vd), 0.0, 1.0);
  float rimF = smoothstep(0.62, 0.78, 1.0 - ndv) * ${rim.toFixed(3)};
  // Rim only on the lit side, so the terminator stays readable.
  float lit = smoothstep(-0.2, 0.4, dot(normal, uSunView));
  outgoingLight += uRimColor * rimF * uRim * (0.35 + 0.65 * lit);
  ${
    gloss > 0
      ? `vec3 Hh = normalize(uSunView + Vd);
  float sp = pow(max(dot(normal, Hh), 0.0), ${(20 + gloss * 80).toFixed(1)});
  outgoingLight += uSpecColor * step(0.55, sp) * ${(0.6 * gloss).toFixed(3)};`
      : ''
  }
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `cel_${gloss}_${rim}_${wind}`;
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outlines
// ─────────────────────────────────────────────────────────────────────────────

const outlineVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 smoothNormal;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uOutlineScale;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = smoothNormal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mvPosition = modelViewMatrix * local;
  vec4 clip = projectionMatrix * mvPosition;
  vec3 nv = normalize(normalMatrix * n);
  vec2 dir = (projectionMatrix * vec4(nv, 0.0)).xy;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(0.0);
  // Constant pixels near the camera, thinning with distance so far props don't blob.
  float px = uWidth * uOutlineScale * ${OUTLINE_THIN.toFixed(2)} * clamp(45.0 / max(clip.w, 1.0), 0.3, 1.0);
  clip.xy += dir * px * 2.0 / uResolution * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;
const outlineFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uOutlineColor;
uniform vec3 uTint;
void main() {
  gl_FragColor = vec4(uOutlineColor * uTint, 1.0);
  #include <fog_fragment>
}
`;

const outlineCache = new Map<string, ShaderMaterial>();

export function outlineMaterial(widthPx = 2.2, tint: ColorRepresentation = 0xffffff): ShaderMaterial {
  const key = `${widthPx}_${new Color(tint).getHexString()}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const m = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uWidth: { value: widthPx },
        uTint: { value: new Color(tint) },
      },
    ]),
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: BackSide,
    fog: true,
  });
  // Shared (by reference) after merge, so one update reaches every outline.
  m.uniforms.uResolution = celShared.uResolution;
  m.uniforms.uOutlineColor = celShared.uOutlineColor;
  m.uniforms.uOutlineScale = celShared.uOutlineScale;
  outlineCache.set(key, m);
  return m;
}

/**
 * Average normals across coincident vertices so flat-shaded geometry gets a
 * watertight outline instead of split shells.
 */
export function addSmoothNormals(geo: BufferGeometry) {
  if (geo.getAttribute('smoothNormal')) return geo;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const map = new Map<string, [number, number, number]>();
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const a = map.get(k) ?? [0, 0, 0];
    a[0] += nrm.getX(i);
    a[1] += nrm.getY(i);
    a[2] += nrm.getZ(i);
    map.set(k, a);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = map.get(key(i))!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l;
    out[i * 3 + 1] = a[1] / l;
    out[i * 3 + 2] = a[2] / l;
  }
  geo.setAttribute('smoothNormal', new BufferAttribute(out, 3));
  return geo;
}

/** Attach an outline shell to a mesh (or instanced mesh). Returns the shell. */
export function addOutline(mesh: Mesh | InstancedMesh, widthPx = 2.2, tint: ColorRepresentation = 0xffffff) {
  addSmoothNormals(mesh.geometry);
  let shell: Mesh;
  if (mesh instanceof InstancedMesh) {
    const im = new InstancedMesh(mesh.geometry, outlineMaterial(widthPx, tint), mesh.count);
    im.instanceMatrix = mesh.instanceMatrix; // shared buffer: one update moves both
    shell = im;
  } else {
    shell = new Mesh(mesh.geometry, outlineMaterial(widthPx, tint));
  }
  shell.frustumCulled = mesh.frustumCulled;
  shell.renderOrder = mesh.renderOrder;
  shell.name = mesh.name + '_ink';
  shell.userData.isOutline = true;
  mesh.add(shell);
  // Instanced shells must not inherit the parent's transform twice: instance
  // matrices are already world-relative to the parent, and the shell is a child
  // at identity, so that is correct as-is.
  return shell;
}

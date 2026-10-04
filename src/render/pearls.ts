/**
 * Pearl visuals: every pearl (placed and scattered) is one instance of a single
 * iridescent sphere mesh, plus one instanced camera-facing halo — two draw
 * calls for the whole field. Pickup / spill sparkles go through the shared
 * particle pool. Reads `Pearls`, owns no gameplay, allocates nothing per frame.
 */

import { AdditiveBlending, Color, Group, IcosahedronGeometry, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { EventQueue } from '../core/events';
import type { Particles } from '../particles/particles';
import type { Pearls } from '../race/pearls';
import { oceanHeight } from '../water/waves';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const PEARL = new Color(1, 0.93, 0.98);
const SHEEN = new Color(0.65, 0.95, 1);

export class PearlVisuals {
  readonly group = new Group();
  private balls: InstancedMesh;
  private halos: InstancedMesh;
  private ballMat: ShaderMaterial;
  private haloMat: ShaderMaterial;

  constructor(
    private pearls: Pearls,
    private particles: Particles,
  ) {
    const n = Math.max(1, pearls.n);
    this.ballMat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vSeed;
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vSeed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vSeed;
        void main(){
          vec3 n = normalize(vN);
          float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
          float fr = pow(1.0 - ndv, 2.2);
          // Nacre: a soft pink-white body with a rainbow film sliding over the rim.
          vec3 film = 0.5 + 0.5 * cos(6.2831 * (fr * 1.3 + n.y * 0.4 + uTime * 0.25 + vSeed + vec3(0.0, 0.33, 0.67)));
          vec3 body = vec3(1.0, 0.94, 0.97) * (0.78 + 0.32 * n.y);
          vec3 col = mix(body, film, 0.45 * fr + 0.12) + pow(max(0.0, dot(reflect(-normalize(vV), n), normalize(vec3(0.3, 1.0, 0.2)))), 24.0) * 0.9;
          gl_FragColor = vec4(col * 1.25, 1.0);
        }`,
    });
    this.balls = new InstancedMesh(new IcosahedronGeometry(0.46, 2), this.ballMat, n);
    // Camera-facing glow quads: billboarded in the vertex shader from the instance centre.
    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main(){
          vUv = uv;
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          c.xy += position.xy * s * 2.6;
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float g = pow(max(0.0, 1.0 - r), 2.4);
          gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * g * (0.75 + 0.25 * sin(uTime * 4.0)), g);
        }`,
    });
    this.halos = new InstancedMesh(new PlaneGeometry(1, 1), this.haloMat, n);
    for (const m of [this.balls, this.halos]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.halos.renderOrder = 2;
  }

  update(time: number, events: EventQueue) {
    const P = this.pearls;
    for (let i = 0; i < P.n; i++) {
      let sc = 0.0001;
      let y = -100;
      if (P.up[i]) {
        // Loose pearls blink before they sink; regrown course pearls pop in.
        const blink = P.fading(i) && Math.floor(time * 10) % 2 === 0;
        sc = blink ? 0.0001 : 1;
        y = oceanHeight(P.x[i], P.z[i], time) + 0.85 + Math.sin(time * 2.6 + i * 0.7) * 0.18;
      }
      _q.identity();
      _m.compose(_p.set(P.x[i], y, P.z[i]), _q, _s.setScalar(sc));
      this.balls.setMatrixAt(i, _m);
      this.halos.setMatrixAt(i, _m);
    }
    this.balls.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    this.ballMat.uniforms.uTime.value = time;
    this.haloMat.uniforms.uTime.value = time;

    const list = events.list;
    const Pt = this.particles;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (e.type === 'pearl') {
        for (let j = 0; j < 14; j++) Pt.emit('spark', e.x, e.y, e.z, (Math.random() - 0.5) * 6, 1 + Math.random() * 5, (Math.random() - 0.5) * 6, j % 2 ? PEARL : SHEEN, 0.8, 1.2);
      } else if (e.type === 'pearlDrop') {
        for (let j = 0; j < 22; j++) Pt.emit('spark', e.x, e.y + 0.8, e.z, (Math.random() - 0.5) * 11, 2 + Math.random() * 6, (Math.random() - 0.5) * 11, j % 2 ? PEARL : SHEEN, 1, 1.4);
      }
    }
  }

  dispose() {
    this.balls.geometry.dispose();
    this.halos.geometry.dispose();
    this.ballMat.dispose();
    this.haloMat.dispose();
    this.group.removeFromParent();
  }
}

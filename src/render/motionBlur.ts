// Motion blur (decisions 341, 342): moving things smear along their motion;
// the camera's own motion never blurs, so panning, zooming and orbiting stay
// sharp.
//
// Three passes a frame, in place of drawing straight to the screen:
// 1. the scene, as always, into an off-screen image (with its own edge smoothing);
// 2. the motion pass: the scene again, every object writing how far each of its
//    pixels moved on screen since the last frame, measured with this frame's
//    camera at both ends (so only the object's own motion counts). Cards use
//    each card's matrix from the last frame; every other object (dice, playmats,
//    stands, flags, close-up images) its world matrix from the last frame. Each
//    keeps its own depth settings, so what is drawn over what stays the same;
//    things that follow the camera (the table) count as still;
// 3. a full-screen pass that averages each pixel along the fastest motion near it,
//    so a smear spills a little past a moving thing's edge, capped in length.
//
// The one exception to "never the camera" (decision 343): while the camera
// swings round to the other side of the table for mirror mode, last frame's
// camera is used for the "before" end too, so the whole view smears with the
// swing.

import * as THREE from 'three';
import type { CardLayer } from './cards';

/** Smear samples per pixel. */
const SAMPLES = 9;
/** The longest smear, as a share of the screen's height: a card tossed across the table doesn't become a streak. */
const MAX_SMEAR = 0.035;
/** How much of a frame's motion is smeared, like a camera's shutter left open this share of the frame. */
const SHUTTER = 0.7;
/** Motion of more than this share of the screen in one frame is a jump (spawned, undone, snapped), not movement: no blur. */
const JUMP = 0.25;

/** Where "before" is seen from: this frame's camera, or (during the mirror swing) last frame's. */
const cameraHead = /* glsl */ `
uniform mat4 uPrevCamera;
uniform float uCameraBlur;
mat4 beforeCamera() {
  return uCameraBlur > 0.5 ? uPrevCamera : projectionMatrix * viewMatrix;
}
`;

const motionVertex = /* glsl */ `
attribute mat4 aPrev;
attribute vec4 aFlags;
varying vec4 vNow;
varying vec4 vPrev;
${cameraHead}
void main() {
  // A hidden card draws nothing, as in the card shader.
  vec3 p = aFlags.w > 0.5 ? vec3(0.0) : position;
  vNow = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
  vPrev = beforeCamera() * modelMatrix * aPrev * vec4(p, 1.0);
  gl_Position = vNow;
}
`;

/** Any other object: its world matrix now and as it was last frame (`uPrev`). */
const objectVertex = /* glsl */ `
uniform mat4 uPrev;
varying vec4 vNow;
varying vec4 vPrev;
${cameraHead}
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vNow = projectionMatrix * viewMatrix * modelMatrix * p;
  vPrev = beforeCamera() * uPrev * p;
  gl_Position = vNow;
}
`;

const motionFragment = /* glsl */ `
varying vec4 vNow;
varying vec4 vPrev;
void main() {
  // How far this point moved since the last frame, in screen widths and heights (0 to 1).
  vec2 v = (vNow.xy / vNow.w - vPrev.xy / vPrev.w) * 0.5;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

const blurVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const blurFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tMotion;
uniform float uMax;
uniform float uShutter;
uniform float uJump;
uniform vec2 uAspect;
varying vec2 vUv;

vec2 motionAt(vec2 uv) {
  vec2 v = texture2D(tMotion, uv).rg;
  return length(v) > uJump ? vec2(0.0) : v;
}

void main() {
  // The fastest motion here or nearby, so the smear reaches a little past a moving card's edge.
  vec2 v = motionAt(vUv);
  float best = dot(v, v);
  vec2 reach = uMax * 0.5 * uAspect;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 w = motionAt(vUv + vec2(cos(a), sin(a)) * reach);
    float l = dot(w, w);
    if (l > best) { best = l; v = w; }
  }
  v *= uShutter;
  // Capped, measured in screen heights so it is the same either way round.
  float len = length(v / uAspect);
  if (len > uMax) v *= uMax / len;
  vec4 color;
  if (len * 1000.0 < 1.0) color = texture2D(tColor, vUv);
  else {
    color = vec4(0.0);
    for (int i = 0; i < ${SAMPLES}; i++) {
      float t = float(i) / ${(SAMPLES - 1).toFixed(1)} - 0.5;
      color += texture2D(tColor, vUv + v * t);
    }
    color /= ${SAMPLES.toFixed(1)};
  }
  gl_FragColor = color;
  #include <colorspace_fragment>
}
`;

/** The ? panel's Motion blur tick, remembered in this browser. */
const OFF_KEY = 'motionBlur.off';

function readWanted(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

export class MotionBlur {
  private enabled = false;
  /** The ? panel's tick: on unless turned off. */
  private want = readWanted();
  /** The graphics mode allows it: High does, Low doesn't. */
  private allow = false;
  private color: THREE.WebGLRenderTarget | null = null;
  private motion: THREE.WebGLRenderTarget | null = null;
  /** Last frame's camera (projection times view), and whether to use it: the mirror swing (decision 343). Shared by every motion material. */
  private readonly cameraUniforms = { uPrevCamera: { value: new THREE.Matrix4() }, uCameraBlur: { value: 0 } };
  private havePrevCamera = false;
  private readonly motionMaterial = new THREE.ShaderMaterial({ vertexShader: motionVertex, fragmentShader: motionFragment, uniforms: this.cameraUniforms });
  /** Motion materials for other objects, one per set of depth settings, so each draws over others as it does in the scene. */
  private readonly objectMaterials = new Map<string, THREE.ShaderMaterial>();
  /** Each object's world matrix as it was drawn last frame. */
  private readonly prev = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  /** What the motion pass swapped, to put back. */
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  private readonly hidden: THREE.Object3D[] = [];
  private readonly drawn: THREE.Object3D[] = [];
  private readonly blurScene = new THREE.Scene();
  private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private readonly clear = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly cards: CardLayer) {
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: blurVertex,
      fragmentShader: blurFragment,
      uniforms: {
        tColor: { value: null },
        tMotion: { value: null },
        uMax: { value: MAX_SMEAR },
        uShutter: { value: SHUTTER },
        uJump: { value: JUMP },
        uAspect: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    quad.frustumCulled = false;
    this.blurScene.add(quad);
  }

  /** The ? panel's tick. */
  get wanted(): boolean {
    return this.want;
  }

  set wanted(v: boolean) {
    this.want = v;
    try {
      localStorage.setItem(OFF_KEY, v ? '0' : '1');
    } catch {
      // Private window or blocked storage: it just isn't remembered.
    }
    this.setOn(this.want && this.allow);
  }

  /** The graphics mode: High allows it, Low doesn't. */
  set allowed(v: boolean) {
    this.allow = v;
    this.setOn(this.want && this.allow);
  }

  /** Off, the scene draws straight to the screen as before, and the images are let go. */
  private setOn(v: boolean) {
    if (v === this.enabled) return;
    this.enabled = v;
    if (v) this.cards.resetPrevious();
    else {
      this.color?.dispose();
      this.motion?.dispose();
      this.color = this.motion = null;
    }
  }

  /** Before the cards' matrices are updated for this frame: last frame's become the previous ones. */
  beforeUpdate(): void {
    if (this.enabled) this.cards.keepPrevious();
  }

  /** A motion material with the same depth settings as `m`. */
  private objectMaterial(m: THREE.Material): THREE.ShaderMaterial {
    const key = `${m.depthTest}${m.depthWrite}${m.side}`;
    let mm = this.objectMaterials.get(key);
    if (!mm) {
      mm = new THREE.ShaderMaterial({
        vertexShader: objectVertex,
        fragmentShader: motionFragment,
        uniforms: { uPrev: { value: new THREE.Matrix4() }, ...this.cameraUniforms },
        depthTest: m.depthTest,
        depthWrite: m.depthWrite,
        side: m.side,
      });
      // Each object its own last-frame matrix; one never drawn before counts as still. Two kinds of
      // object move with the camera (decision 344):
      // - `noBlur`, the table: it slides to stay under the camera, but stands for the fixed table top,
      //   so it is always measured where it is now (still, unless the camera's swing blurs);
      // - `followsCamera`, a flag's pole and cloth: they turn and slide round to face the camera, so on
      //   screen they hardly move. Measured against the camera alone they count as still; when the
      //   swing blurs the camera, their real last-frame place is used, which nearly cancels it.
      const uniforms = mm.uniforms;
      mm.onBeforeRender = (_r, _s, _c, _g, object) => {
        const d = object.userData;
        const swing = this.cameraUniforms.uCameraBlur.value > 0.5;
        const prev = d.noBlur || (d.followsCamera && !swing) ? undefined : this.prev.get(object);
        uniforms.uPrev.value.copy(prev ?? object.matrixWorld);
        mm!.uniformsNeedUpdate = true;
      };
      this.objectMaterials.set(key, mm);
    }
    return mm;
  }

  /**
   * Give every drawn object its motion material for the motion pass. Points,
   * lines and sprites (markers, outlines) sit it out; so do materials that
   * draw nothing (a flag's grip, a shadow stand-in), which keep their own.
   */
  private swap(): void {
    this.drawn.length = 0;
    const cards = this.cards.object;
    this.scene.traverseVisible((o) => {
      if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
        o.visible = false;
        this.hidden.push(o);
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material;
      if (mesh === cards) {
        this.swapped.push({ mesh, material });
        mesh.material = this.motionMaterial;
        return;
      }
      const list = Array.isArray(material) ? material : [material];
      if (list.some((m) => !m.visible || !m.colorWrite)) return;
      this.swapped.push({ mesh, material });
      mesh.material = Array.isArray(material) ? material.map((m) => this.objectMaterial(m)) : this.objectMaterial(material);
      this.drawn.push(mesh);
    });
  }

  private restore(): void {
    for (const s of this.swapped) s.mesh.material = s.material;
    for (const o of this.hidden) o.visible = true;
    this.swapped.length = 0;
    this.hidden.length = 0;
  }

  /** Draw a frame. `swinging`: the camera is turning to the other side for mirror mode, and its motion blurs too. */
  render(camera: THREE.Camera, swinging = false): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.render(this.scene, camera);
      this.havePrevCamera = false;
      return;
    }
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    if (!this.color || this.color.width !== w || this.color.height !== h) {
      this.color?.dispose();
      this.motion?.dispose();
      // Half floats keep the colors exact before the screen's encoding; four samples smooth edges as the screen did.
      this.color = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      // Motion at half size is plenty for a smear.
      this.motion = new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    // 1. The scene, off screen.
    r.setRenderTarget(this.color);
    r.render(this.scene, camera);
    // 2. The motion pass: the same scene, every object with its motion material, no background, no new shadows.
    const cameraBlur = swinging && this.havePrevCamera;
    this.cameraUniforms.uCameraBlur.value = cameraBlur ? 1 : 0;
    this.motionMaterial.uniformsNeedUpdate = true;
    this.swap();
    const background = this.scene.background;
    const shadows = r.shadowMap.autoUpdate;
    r.getClearColor(this.clear);
    const alpha = r.getClearAlpha();
    this.scene.background = null;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.motion);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, camera);
    r.setClearColor(this.clear, alpha);
    r.shadowMap.autoUpdate = shadows;
    this.scene.background = background;
    this.restore();
    // This frame's camera is next frame's previous one.
    this.cameraUniforms.uPrevCamera.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.havePrevCamera = true;
    // This frame's world matrices are next frame's previous ones.
    for (const o of this.drawn) {
      const m = this.prev.get(o);
      if (m) m.copy(o.matrixWorld);
      else this.prev.set(o, o.matrixWorld.clone());
    }
    // 3. The smear, to the screen.
    const u = this.blurMaterial.uniforms;
    u.tColor.value = this.color!.texture;
    u.tMotion.value = this.motion!.texture;
    u.uAspect.value.set(h / w, 1);
    // A swing moves the whole view a long way each frame: no motion there counts as a jump.
    u.uJump.value = cameraBlur ? 1e6 : JUMP;
    r.setRenderTarget(null);
    r.render(this.blurScene, this.blurCamera);
  }
}

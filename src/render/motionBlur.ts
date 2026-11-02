// Motion blur (decision 341): moving cards smear along their motion; the
// camera's own motion never blurs, so panning, zooming and orbiting stay sharp.
//
// Three passes a frame, in place of drawing straight to the screen:
// 1. the scene, as always, into an off-screen image (with its own edge smoothing);
// 2. the motion pass: the cards alone, each pixel writing how far its card moved
//    on screen since the last frame, measured with this frame's camera at both
//    ends (so only the card's own motion counts);
// 3. a full-screen pass that averages each pixel along the fastest motion near it,
//    so a smear spills a little past a moving card's edge, capped in length.
// Dice, stands and other objects are drawn sharp; only cards blur.

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

const motionVertex = /* glsl */ `
attribute mat4 aPrev;
attribute vec4 aFlags;
varying vec4 vNow;
varying vec4 vPrev;
void main() {
  // A hidden card draws nothing, as in the card shader.
  vec3 p = aFlags.w > 0.5 ? vec3(0.0) : position;
  vNow = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
  vPrev = projectionMatrix * viewMatrix * modelMatrix * aPrev * vec4(p, 1.0);
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
  private readonly motionScene = new THREE.Scene();
  private readonly motionMaterial = new THREE.ShaderMaterial({ vertexShader: motionVertex, fragmentShader: motionFragment });
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

  render(camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.render(this.scene, camera);
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
    // 2. The cards' motion. The card mesh visits the motion scene with the motion material, then goes back.
    const mesh = this.cards.object;
    const parent = mesh.parent;
    const material = mesh.material;
    r.getClearColor(this.clear);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.motion);
    r.setClearColor(0x000000, 0);
    this.motionScene.add(mesh);
    mesh.material = this.motionMaterial;
    r.clear();
    r.render(this.motionScene, camera);
    mesh.material = material;
    parent?.add(mesh);
    r.setClearColor(this.clear, alpha);
    // 3. The smear, to the screen.
    const u = this.blurMaterial.uniforms;
    u.tColor.value = this.color!.texture;
    u.tMotion.value = this.motion!.texture;
    u.uAspect.value.set(h / w, 1);
    r.setRenderTarget(null);
    r.render(this.blurScene, this.blurCamera);
  }
}

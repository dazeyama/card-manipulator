// The table, lights and shadows (spec 7.1, 7.1a, 8.5).

import * as THREE from 'three';
import type { CameraRig } from './camera';

const TABLE_COLOR = 0xe7e4df;
const LIGHT_DIR = new THREE.Vector3(-0.35, -0.55, 1).normalize();

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly table: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  private readonly tableUniforms = { uFocus: { value: new THREE.Vector3() }, uScale: { value: 1000 } };
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly lightSpace = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(TABLE_COLOR);

    this.scene.background = new THREE.Color(TABLE_COLOR);

    // Soft ambient plus one sun. Levels are chosen so a card in full light shows
    // close to its printed colours with no tone mapping.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 1.35));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 8000;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.table = this.makeTable();
    this.scene.add(this.table);
  }

  private makeTable(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: TABLE_COLOR });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.tableUniforms);
      shader.vertexShader = 'varying vec3 vTableP;\n' + shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTableP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = /* glsl */ `
varying vec3 vTableP;
uniform vec3 uFocus;
uniform float uScale;
float gridLine(vec2 p, float spacing) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) / fwidth(p / spacing);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
float fade = 1.0 - smoothstep(uScale * 0.6, uScale * 2.4, length(vTableP.xy - uFocus.xy));
float minor = gridLine(vTableP.xy, 100.0) * (1.0 - smoothstep(1200.0, 2600.0, uScale));
float major = gridLine(vTableP.xy, 500.0);
diffuseColor.rgb *= 1.0 - fade * (0.035 * minor + 0.06 * major);`,
      );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.scale.set(400000, 400000, 1);
    mesh.renderOrder = -1;
    return mesh;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  /** Follow the camera: keep the table centred and fit the shadow map to what is visible. */
  fitToView(rig: CameraRig): void {
    const t = rig.target;
    this.table.position.set(t.x, t.y, 0);
    this.tableUniforms.uFocus.value.copy(t);
    this.tableUniforms.uScale.value = rig.visibleWidth();

    // Footprint of the view on the table, clamped so a low camera doesn't stretch the map.
    const { width, height } = rig.viewport;
    const limit = rig.visibleWidth() * 1.6;
    const pts: [number, number][] = [[0, 0], [width, 0], [width, height], [0, height]];
    pts.forEach(([sx, sy], i) => {
      const hit = rig.screenToPlane(sx, sy, 0, this.corners[i]);
      const c = this.corners[i];
      if (!hit) c.set(t.x, t.y + limit, 0);
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      const len = Math.hypot(dx, dy);
      if (len > limit) c.set(t.x + (dx / len) * limit, t.y + (dy / len) * limit, 0);
    });

    const center = new THREE.Vector3();
    this.corners.forEach((c) => center.add(c));
    center.multiplyScalar(0.25);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(LIGHT_DIR, 3000);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    this.lightSpace.copy(cam.matrixWorldInverse);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const c of this.corners) {
      for (const z of [0, 300]) {
        v.set(c.x, c.y, z).applyMatrix4(this.lightSpace);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
    const pad = 60;
    cam.left = minX - pad;
    cam.right = maxX + pad;
    cam.bottom = minY - pad;
    cam.top = maxY + pad;
    cam.updateProjectionMatrix();
    // Normal bias in world units scales with the shadow texel size.
    const texel = Math.max(maxX - minX, maxY - minY) / this.sun.shadow.mapSize.x;
    this.sun.shadow.normalBias = texel * 0.8;
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}

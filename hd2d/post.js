// HD-2D 後製：移軸景深（依畫面高度模糊上下緣）＋光暈＋暗角＋色調，最後自行做色調映射與 sRGB 轉換。
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const TILT = `
uniform sampler2D tDiffuse; uniform vec2 dir; uniform float focusY; uniform float band; uniform float maxBlur;
varying vec2 vUv;
void main(){
  float d = vUv.y - focusY;
  float amt = smoothstep(band, band + 0.32, abs(d)) * maxBlur * (d > 0.0 ? 1.0 : 0.75);
  vec4 sum = vec4(0.0); float ws = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i); float w = exp(-fi * fi / 18.0);
    sum += texture2D(tDiffuse, vUv + dir * fi * amt / 6.0) * w; ws += w;
  }
  gl_FragColor = sum / ws;
}`;

const BRIGHT = `
uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.6, l), 1.0);
}`;

const BLUR = `
uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D tDiffuse; uniform sampler2D tBloomA; uniform sampler2D tBloomB;
uniform float bloom; uniform float exposure; uniform float aspect; uniform float time; uniform vec2 res; uniform float fade;
varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  col += (texture2D(tBloomA, vUv).rgb * 0.7 + texture2D(tBloomB, vUv).rgb * 0.9) * bloom;
  col = aces(col * exposure);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.9, 0.96, 1.1), (1.0 - lum) * 0.4);
  col = mix(col, col * vec3(1.07, 1.0, 0.88), lum * 0.35);
  vec2 p = vUv - 0.5; p.x *= aspect;
  col *= mix(0.5, 1.0, smoothstep(0.95, 0.3, length(p)));
  col = clamp(col, 0.0, 1.0);
  col = toSRGB(col) + (hash(vUv * res + fract(time)) - 0.5) * 0.025;
  gl_FragColor = vec4(col * fade, 1.0);
}`;

export class HD2DPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.tilt = mk(TILT, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() }, focusY: { value: 0.45 }, band: { value: 0.1 }, maxBlur: { value: 7 } });
    this.bright = mk(BRIGHT, { tDiffuse: { value: null }, threshold: { value: 0.85 } });
    this.blur = mk(BLUR, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } });
    this.comp = mk(COMPOSITE, {
      tDiffuse: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, bloom: { value: 1.0 }, exposure: { value: 1.0 },
      aspect: { value: 1 }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, fade: { value: 1 }
    });
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opt);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opt);
    this.h1 = new THREE.WebGLRenderTarget(1, 1, opt); this.h2 = new THREE.WebGLRenderTarget(1, 1, opt);
    this.q1 = new THREE.WebGLRenderTarget(1, 1, opt); this.q2 = new THREE.WebGLRenderTarget(1, 1, opt);
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h); this.rtA.setSize(w, h); this.rtB.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.h1.setSize(hw, hh); this.h2.setSize(hw, hh); this.q1.setSize(qw, qh); this.q2.setSize(qw, qh);
    this.comp.uniforms.aspect.value = w / h;
    this.comp.uniforms.res.value.set(w, h);
  }

  pass(mat, input, target) {
    if (mat.uniforms.tDiffuse) mat.uniforms.tDiffuse.value = input ? input.texture : null;
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, opts) {
    const { w, h } = this, r = this.renderer;
    r.setRenderTarget(this.rtScene); r.render(scene, camera);
    // 光暈：亮部擷取 → 半解析度與四分之一解析度各模糊一次
    this.pass(this.bright, this.rtScene, this.h1);
    this.blur.uniforms.dir.value.set(2 / (w >> 1), 0); this.pass(this.blur, this.h1, this.h2);
    this.blur.uniforms.dir.value.set(0, 2 / (h >> 1)); this.pass(this.blur, this.h2, this.h1);
    this.blur.uniforms.dir.value.set(2 / (w >> 2), 0); this.pass(this.blur, this.h1, this.q2);
    this.blur.uniforms.dir.value.set(0, 2 / (h >> 2)); this.pass(this.blur, this.q2, this.q1);
    // 移軸景深：先水平、再垂直
    this.tilt.uniforms.focusY.value = opts.focusY;
    this.tilt.uniforms.maxBlur.value = opts.blur;
    this.tilt.uniforms.band.value = opts.band ?? 0.1;
    this.tilt.uniforms.dir.value.set(1 / w, 0); this.pass(this.tilt, this.rtScene, this.rtA);
    this.tilt.uniforms.dir.value.set(0, 1 / h); this.pass(this.tilt, this.rtA, this.rtB);
    const u = this.comp.uniforms;
    u.tBloomA.value = this.h1.texture; u.tBloomB.value = this.q1.texture;
    u.bloom.value = opts.bloom; u.exposure.value = opts.exposure; u.time.value = opts.time; u.fade.value = opts.fade;
    this.pass(this.comp, this.rtB, null);
  }

  dispose() {
    for (const k of ['rtScene', 'rtA', 'rtB', 'h1', 'h2', 'q1', 'q2']) this[k].dispose();
  }
}

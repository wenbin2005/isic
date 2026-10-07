/* WebGPU 管線（四景）：以 TSL 重寫 shaders.js 的材質修補與自訂效果，加上物理天空大氣與 TAA。
   1. 只在瀏覽器提供 WebGPU 時由 app.js 載入；其餘情況仍走 engine.js 原本的 WebGL 路徑。
   2. 場景幾何與擺放沿用 engine.js，這裡只提供渲染器、材質節點與後處理。
   3. 天空改為「Rayleigh＋Mie＋臭氧」單次散射加多重散射近似，開景時烘一次方向查表（LUT），
      天空背景、霧色、水面反射與環境光都讀同一張表，四者天色一致。
   4. 霧改在線性 HDR 空間、色調映射之前混入，霧色取自同一張天空查表（簡化版空氣透視）。
   參考：webgpu-render-pipeline 技能（framegraph-taa-sky.md）的大氣參數與 TAA 雷區；程式為自寫。 */
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, vec2, vec3, vec4, uniform, attribute, instancedBufferAttribute, texture, uv,
  positionLocal, positionPrevious, positionWorld, positionGeometry, positionView, positionWorldDirection, normalGeometry, normalWorldGeometry, normalViewGeometry,
  cameraPosition, cameraViewMatrix, frontFacing, diffuseColor, vertexColor, materialColor, screenDPR, modelWorldMatrix, varying, varyingProperty,
  floor, fract, dot, mix, smoothstep, clamp, max, abs, exp, sin, cos, pow, sqrt, normalize, length, cross, select, atan, asin, sign, step,
  fog, mrt, output, velocity, pass,
} from 'three/tsl';
import { traa } from './vendor/addons/tsl/display/TRAANode.js';

export { THREE };
export const MeshStandardNodeMaterial = THREE.MeshStandardNodeMaterial;

const PI = Math.PI;
// 舊版光束與浮塵不經色調映射、直接加在顯示值上；移到線性 HDR 後要放大才看得出同樣的亮度（手調值）。
const DISPLAY_TO_HDR = 2;
// 霧在線性空間混入時，同樣的濃度看起來比舊版（顯示空間混入）更白更濃；以此係數拉回（手調值）。
const FOG_DENSITY = 0.65;
// 霧色一半取物理天空、一半取各景 LOOKS 指定的霧色與向陽霧色，保留秋林、海岸的暖調（手調值）。
const FOG_TINT = 0.6;
const FOG_TINT_GAIN = 1.3; // 顯示值轉線性後的亮度補償；2 會讓森林霧太白（手調值）

/* ───── 雜訊（與 shaders.js 的 NOISE_GLSL 同一公式，函式化避免 WGSL 膨脹）───── */
const nHash = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'nHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const nValue = Fn(([p]) => {
  const i = floor(p), f = fract(p), u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(nHash(i), nHash(i.add(vec2(1, 0))), u.x), mix(nHash(i.add(vec2(0, 1))), nHash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: 'nValue', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

function fbm(name, octaves, norm) {
  return Fn(([start]) => {
    const p = vec2(start).toVar(), v = float(0).toVar(), a = float(0.5).toVar();
    Loop(octaves, () => {
      v.addAssign(a.mul(nValue(p)));
      p.assign(vec2(p.x.mul(1.6).sub(p.y.mul(1.2)), p.x.mul(1.2).add(p.y.mul(1.6))).add(7.31));
      a.mulAssign(0.5);
    });
    return v.div(norm);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
}
const nFbm = fbm('nFbm', 5, 0.97);
const nFbm3 = fbm('nFbm3', 3, 0.875);

// 與 engine.js 的 pathX／creekX 相同。
const trailX = z => sin(z.mul(0.075)).mul(3.1).add(sin(z.mul(0.041)).mul(1.5));
const creekX = z => trailX(z).add(8.4).add(sin(z.mul(0.13)).mul(0.8));
const oceanShore = z => sin(z.mul(0.095)).mul(1.3).add(5.2);
const oceanBed = p => oceanShore(p.y).sub(p.x).mul(0.033).add(0.74).sub(max(p.x.sub(oceanShore(p.y)).add(6), 0).mul(0.125)).add(sin(p.y.mul(0.065)).mul(sin(p.x.mul(0.07))).mul(0.1));

// 顏色常數一律拆成三個分量：實測 vec3(Color) 在這版 TSL 得到近乎 0（光束因此全暗）。
const rgb = value => { const c = new THREE.Color(value); return vec3(c.r, c.g, c.b); };
// engine.js 的 LOOKS.ground 以 GLSL 字串保存色彩；這裡轉回數值。
const glslVec3 = text => { const n = text.replace(/^\s*vec3/, '').match(/-?[\d.]+/g).map(Number); return vec3(n[0], n[1] ?? n[0], n[2] ?? n[0]); };

/* ───── 天空大氣 ───── */
// Hillaire 2020 表 1（單位 km）。
const ATMO = {
  ground: 6360, top: 6460, eye: 0.3,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighHeight: 8,
  mieScatter: 3.996e-3, mieExtinction: 4.44e-3, mieHeight: 1.2, mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3], ozoneCenter: 25, ozoneWidth: 15,
};
const LUT_SIZE = [256, 128];

/** 方向 ↔ 查表座標：方位角線性；仰角以平方根律集中在地平線附近（地平線的色彩變化最劇烈）。 */
const lutUV = Fn(([d]) => {
  const e = asin(clamp(d.y, -1, 1)).div(PI / 2);
  return vec2(atan(d.z, d.x).div(2 * PI).add(0.5), sign(e).mul(sqrt(abs(e))).mul(0.5).add(0.5));
});

/** 單點的消光係數（Rayleigh＋Mie＋臭氧）與兩種散射密度。 */
function medium(h) {
  const rhoR = exp(h.div(-ATMO.rayleighHeight)), rhoM = exp(h.div(-ATMO.mieHeight));
  const rhoO = max(float(1).sub(abs(h.sub(ATMO.ozoneCenter)).div(ATMO.ozoneWidth)), 0);
  const extinction = vec3(...ATMO.rayleigh).mul(rhoR).add(float(ATMO.mieExtinction).mul(rhoM)).add(vec3(...ATMO.ozone).mul(rhoO));
  return { rhoR, rhoM, extinction };
}

/** 烘焙查表：每個 texel 沿視線 32 步、朝太陽 8 步積分；含行星陰影與地面反照。 */
function bakeMaterial(u) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const t = uv(), s = t.y.mul(2).sub(1), elevation = sign(s).mul(s).mul(s).mul(PI / 2), azimuth = t.x.sub(0.5).mul(2 * PI);
    const d = vec3(cos(elevation).mul(cos(azimuth)), sin(elevation), cos(elevation).mul(sin(azimuth)));
    const ro = vec3(0, ATMO.ground + ATMO.eye, 0), b = ro.y.mul(d.y);
    const tTop = b.negate().add(sqrt(b.mul(b).sub(ro.y.mul(ro.y).sub(ATMO.top * ATMO.top))));
    const groundDisc = b.mul(b).sub(ro.y.mul(ro.y).sub(ATMO.ground * ATMO.ground));
    const tGround = b.negate().sub(sqrt(max(groundDisc, 0)));
    const hitsGround = groundDisc.greaterThan(0).and(tGround.greaterThan(0));
    const tMax = select(hitsGround, tGround, tTop);
    const sun = u.sunDirection, nu = dot(d, sun);
    const depthView = vec3(0).toVar(), inR = vec3(0).toVar(), inM = vec3(0).toVar(), multi = vec3(0).toVar(), sunT = vec3(1).toVar();
    const STEPS = 32, LIGHT = 8;
    Loop({ start: 0, end: STEPS, type: 'int' }, ({ i }) => {
      const fi = float(i), t0 = tMax.mul(fi.div(STEPS).pow(2)), t1 = tMax.mul(fi.add(1).div(STEPS).pow(2)), dt = t1.sub(t0);
      const tt = mix(t0, t1, 0.3), p = ro.add(d.mul(tt)), r = length(p), m = medium(r.sub(ATMO.ground));
      const transView = exp(depthView.add(m.extinction.mul(tt.sub(t0))).negate());
      // 朝太陽：到大氣頂的距離；被行星擋住時為 0。
      const bl = dot(p, sun), cl = r.mul(r);
      const tl = bl.negate().add(sqrt(max(bl.mul(bl).sub(cl.sub(ATMO.top * ATMO.top)), 0)));
      const discL = bl.mul(bl).sub(cl.sub(ATMO.ground * ATMO.ground));
      const lit = select(discL.greaterThan(0).and(bl.negate().sub(sqrt(max(discL, 0))).greaterThan(0)), float(0), float(1));
      const depthLight = vec3(0).toVar();
      Loop({ start: 0, end: LIGHT, type: 'int' }, ({ i: j }) => {
        const q = p.add(sun.mul(tl.mul(float(j).add(0.5).div(LIGHT))));
        depthLight.addAssign(medium(length(q).sub(ATMO.ground)).extinction.mul(tl.div(LIGHT)));
      });
      const toSun = exp(depthLight.negate()).mul(lit);
      sunT.assign(toSun);
      inR.addAssign(transView.mul(toSun).mul(m.rhoR).mul(dt));
      inM.addAssign(transView.mul(toSun).mul(m.rhoM).mul(dt));
      multi.addAssign(transView.mul(vec3(...ATMO.rayleigh).mul(m.rhoR).add(float(ATMO.mieScatter).mul(m.rhoM))).mul(dt));
      depthView.addAssign(m.extinction.mul(dt));
    });
    const g = ATMO.mieG;
    const phaseR = float(3 / (16 * PI)).mul(nu.mul(nu).add(1));
    const phaseM = float(3 / (8 * PI) * (1 - g * g) / (2 + g * g)).mul(nu.mul(nu).add(1)).div(pow(float(1 + g * g).sub(nu.mul(2 * g)), 1.5));
    const single = vec3(...ATMO.rayleigh).mul(inR).mul(phaseR).add(float(ATMO.mieScatter).mul(inM).mul(phaseM));
    // 多重散射：以「太陽高度×偏藍的等向散射」近似，避免天頂與背光側過暗（手調值，見 WebGPU 試點紀錄）。
    const ambient = multi.mul(max(sun.y, 0.05).mul(0.2)).mul(vec3(0.55, 0.75, 1));
    const groundLit = select(hitsGround, exp(depthView.negate()).mul(u.groundAlbedo).mul(max(sun.y, 0)).mul(sunT).div(PI), vec3(0));
    // 大氣外的太陽光是白光；engine 的 sunLight 是地表看到的暖色，取其最大分量當白光強度。
    const solar = max(u.sunLight.r, max(u.sunLight.g, u.sunLight.b));
    return single.add(ambient).add(groundLit).mul(solar).mul(u.skyGain);
  })();
  return material;
}

/** 每個探索器一份：同一批 uniform 掛在所有節點上，切景只改數值。 */
export function createGpuAtmosphere(atmo) {
  const u = {
    sunDirection: uniform(atmo.sunDirection.value),
    sunLight: uniform(atmo.sunLight.value),
    time: uniform(0),
    previousTime: uniform(0),
    wind: uniform(1).onRenderUpdate(() => atmo.wind.value),
    cloudCover: uniform(0.3).onRenderUpdate(() => atmo.cloudCover.value),
    fogHeight: uniform(atmo.fogHeight.value),
    fogRange: uniform(new THREE.Vector2(6, 170)),
    fogGain: uniform(0.7),
    skyGain: uniform(2),
    groundAlbedo: uniform(new THREE.Color(0.18, 0.2, 0.12)),
    pointScale: uniform(400).onRenderUpdate(() => atmo.pointScale.value),
    hazeColor: uniform(atmo.hazeColor.value),
    fogSunColor: uniform(atmo.fogSunColor.value),
  };
  const lut = new THREE.RenderTarget(...LUT_SIZE, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
  lut.texture.wrapS = THREE.RepeatWrapping; lut.texture.wrapT = THREE.ClampToEdgeWrapping;
  const sampleSky = d => texture(lut.texture, lutUV(d)).rgb;
  const bake = new THREE.QuadMesh(bakeMaterial(u));

  /** 天空：查表＋流動雲層＋日輪；envPass 時不畫日輪（環境光另以太陽直射光計算）。 */
  const skyColor = (d, disk, cloudy) => Fn(() => {
    const color = sampleSky(d).toVar(), mu = max(dot(d, u.sunDirection), 0), h = max(d.y, 0);
    const p = d.xz.div(h.add(0.1)).mul(0.62).add(vec2(u.time.mul(0.006), u.time.mul(0.0025)));
    const base = nFbm(p.mul(1.15)), cover = smoothstep(float(1).sub(u.cloudCover).sub(0.1), float(1).sub(u.cloudCover).add(0.3), base);
    const toward = nFbm(p.mul(1.15).add(u.sunDirection.xz.mul(0.12)));
    const light = clamp(base.sub(toward).mul(4.5).add(0.62), 0, 1);
    const zenith = sampleSky(vec3(0, 1, 0)), horizon = sampleSky(normalize(vec3(d.x, 0.04, d.z)));
    // 雲底受天空漫射、雲頂受太陽照亮；朝太陽方向加上銀邊。
    const shade = mix(horizon, zenith, 0.45).mul(1.1);
    const lit = u.sunLight.mul(0.2).add(zenith.mul(0.6));
    const cloud = mix(shade, lit, light).add(u.sunLight.mul(pow(mu, 10).mul(0.12)));
    const alpha = cover.mul(smoothstep(0, 0.14, d.y)).mul(cloudy);
    // 遠方雲層溶入地平線的大氣
    color.assign(mix(color, mix(cloud, horizon, smoothstep(0.25, 0, d.y).mul(0.6)), alpha));
    const sunDisk = smoothstep(0.99985, 0.99994, mu).mul(disk).mul(float(1).sub(alpha));
    // 日輪外圍的光暈（大氣散射在查表解析度下不夠集中，補一層；手調值）。
    const halo = pow(mu, 300).mul(1.2).add(pow(mu, 12).mul(0.08)).mul(disk).mul(float(1).sub(alpha.mul(0.6)));
    color.addAssign(u.sunLight.mul(sunDisk.mul(12).add(halo)));
    return color;
  })();

  /** 線性空間的高度霧：密度公式同 shaders.js 的 fog_fragment，霧色改取天空查表。 */
  const fogNode = Fn(() => {
    const ray = positionWorld.sub(cameraPosition), dist = max(length(ray), 1e-4), d = ray.div(dist);
    const span = max(dist.sub(u.fogRange.x), 0), density = float(FOG_DENSITY).div(max(u.fogRange.y, 1));
    const rise = u.fogHeight.y.mul(ray.y).mul(span).div(dist);
    const layer = select(abs(rise).greaterThan(1e-3), float(1).sub(exp(rise.negate())).div(rise), float(1).sub(rise.mul(0.5)));
    const factor = float(1).sub(exp(density.mul(span).mul(exp(u.fogHeight.y.mul(cameraPosition.y.sub(u.fogHeight.x)).negate())).mul(layer).negate()));
    // 霧中朝太陽方向的前向散射（暖色光暈），強度沿用 LOOKS 的 scatter（fogHeight.z），係數為手調值。
    const toward = pow(max(dot(d, u.sunDirection), 0), 6).mul(u.fogHeight.z), forward = toward.mul(0.35);
    const physical = sampleSky(normalize(vec3(d.x, max(d.y, 0.03), d.z))).mul(u.fogGain).add(u.sunLight.mul(forward));
    // LOOKS 的霧色是顯示值：轉回線性再放大到 HDR，與 shaders.js 相同依向陽程度混入向陽霧色。
    const artistic = pow(mix(u.hazeColor, u.fogSunColor, clamp(toward, 0, 1)), vec3(2.2)).mul(FOG_TINT_GAIN);
    const haze = mix(physical, artistic, FOG_TINT);
    return fog(haze, factor);
  })();

  return {
    u, lut, skyColor, sampleSky, fogNode,
    /** 每幀呼叫一次：記下前一幀時間，風擺的速度向量才算得出「這一幀動了多少」。 */
    frame(time) { u.previousTime.value = u.time.value; u.time.value = time; },
    bake(renderer) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(lut); bake.render(renderer); renderer.setRenderTarget(previous);
    },
    dispose() { lut.dispose(); bake.material.dispose(); },
  };
}

/** 天空穹頂與環境光：背景節點讀查表；環境光以同一片天空（含雲、不含日輪）烘 PMREM。 */
export function installSky(renderer, scene, sky, pmrem) {
  scene.backgroundNode = sky.skyColor(positionWorldDirection, 1, 1);
  scene.fog = null;
  scene.fogNode = sky.fogNode;
  const envScene = new THREE.Scene(), material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });
  material.colorNode = sky.skyColor(normalize(positionLocal), 0, 0.7);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material);
  envScene.add(dome);
  const target = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
  dome.geometry.dispose(); material.dispose();
  return target;
}

/* ───── 材質修補（對應 shaders.js 的 patch*）───── */

/** 微風擺動：與 GLSL 版同公式。positionPrevious 也套上「前一幀」的擺動，TAA 的速度向量才不會把風當成位移（技能 §2.2）。 */
function windOffset(p, weight, time, strength) {
  const gust = sin(time.mul(0.37).add(p.x.mul(0.021)).add(p.z.mul(0.017))).mul(0.45).add(0.55);
  const sway = sin(time.mul(1.6).add(p.x.mul(0.23)).add(p.z.mul(0.19))).add(sin(time.mul(2.7).add(p.x.mul(0.61)).sub(p.z.mul(0.47))).mul(0.45));
  return vec3(0.8, 0.15, 0.5).mul(sway.mul(gust).mul(weight).mul(strength));
}
function windWeight(text) {
  let match = text.match(/mvPosition\.y - ([\d.]+) \) \* ([\d.]+), 0\.0, ([\d.]+)/);
  if (match) { const [, base, rate, top] = match.map(Number); return p => clamp(p.y.sub(base).mul(rate), 0, top); }
  match = text.match(/^uv\.y \* ([\d.]+)$/);
  if (match) { const rate = Number(match[1]); return () => uv().y.mul(rate); }
  const constant = Number(text);
  if (Number.isFinite(constant)) return constant === 0 ? null : () => float(constant);
  throw new Error(`無法轉換的擺動權重：${text}`);
}

/** 植被：微風擺動、背面不翻轉法線、樹冠球面法線、逆光透葉。 */
export function patchFoliage(material, sky, { weight, crown = false, upNormal = false, translucency = 0 }) {
  const { u } = sky, weightOf = windWeight(weight);
  // TAA 取代 MSAA，透明度覆蓋（alphaToCoverage）在無多重取樣時無效，改用一般 alphaTest。
  material.alphaToCoverage = false;
  if (weightOf) {
    material.positionNode = Fn(() => {
      const previous = positionPrevious;
      positionPrevious.assign(previous.add(windOffset(previous, weightOf(previous), u.previousTime, u.wind)));
      return positionLocal.add(windOffset(positionLocal, weightOf(positionLocal), u.time, u.wind));
    })();
  }
  if (crown) material.normalNode = normalize(cameraViewMatrix.mul(vec4(attribute('crownNormal', 'vec3'), 0)).xyz);
  else if (upNormal) material.normalNode = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  else material.normalNode = normalViewGeometry;
  if (translucency) {
    const behind = pow(max(dot(normalize(positionWorld.sub(cameraPosition)), u.sunDirection), 0), 3);
    material.emissiveNode = diffuseColor.rgb.mul(u.sunLight).mul(behind).mul(translucency);
  }
  return material;
}

/** 樹皮：根部壓暗；森林另有苔蘚。 */
export function patchBark(material, key) {
  material.colorNode = Fn(() => {
    const c = vec4(materialColor), h = positionGeometry.y.add(0.5);
    const rgb = c.rgb.mul(mix(0.45, 1, smoothstep(0, 0.08, h))).toVar();
    if (key === 'forest') {
      const moss = float(1).sub(smoothstep(0.02, nValue(vec2(h.mul(60), select(frontFacing, float(1), float(2)))).mul(0.1).add(0.14), h));
      rgb.assign(mix(rgb, vec3(0.11, 0.16, 0.05), moss.mul(0.7)));
    }
    return vec4(rgb, c.a);
  })();
  return material;
}

/** 岩石：頂面依場景覆上苔蘚、地衣或積雪；海岸潮線以下較深較濕。 */
export function patchRock(material, key) {
  material.colorNode = Fn(() => {
    const c = vec4(materialColor), n = normalize(normalWorldGeometry), w = positionWorld;
    const top = smoothstep(0.2, 0.7, n.y.add(nValue(w.xz.mul(2.6).add(w.y)).sub(0.5).mul(0.45)));
    if (key === 'forest') return vec4(mix(c.rgb, vec3(0.1, 0.16, 0.04).mul(nValue(w.xz.mul(9)).mul(0.5).add(0.8)), top.mul(0.82)), c.a);
    if (key === 'autumn') return vec4(mix(c.rgb, vec3(0.24, 0.2, 0.07), top.mul(0.55)), c.a);
    if (key === 'snow') return vec4(mix(c.rgb, vec3(0.93, 0.95, 0.97), smoothstep(0.15, 0.45, top)), c.a);
    return vec4(c.rgb.mul(mix(0.55, 1, smoothstep(0.05, 0.55, w.y))), c.a);
  })();
  return material;
}

/** 地表：去重複色彩、軟邊步道、依場景的苔蘚／落葉／雪地／濕沙、遠山林相與雪線、雪地閃光。頂點色在此先乘，修補順序與 GLSL 版相同。 */
export function patchGround(material, look, { map, detail, pathMap, repeat, key, sky }) {
  material.vertexColors = false;
  const roughness = material.roughness;
  const gp = positionWorld.xz, worldY = positionWorld.y;
  const fine = nValue(gp.mul(0.6));
  const inWorld = float(1).sub(smoothstep(58, 64, abs(gp.y)));
  const creekBank = float(1).sub(smoothstep(1, 2.7, abs(gp.x.sub(creekX(gp.y))).add(fine.sub(0.5).mul(0.6)))).mul(inWorld);
  const wetSand = smoothstep(oceanShore(gp.y).sub(3.2), oceanShore(gp.y).add(0.6), gp.x.add(fine.sub(0.5).mul(0.8)));
  const wet = key === 'forest' ? creekBank.mul(0.85) : key === 'ocean' ? wetSand : null;
  material.colorNode = Fn(() => {
    const tint = vertexColor().rgb, base = uv().mul(repeat);
    const macro = nFbm3(gp.mul(0.045));
    // 雪林沒有地表貼圖（GLSL 版的 USE_MAP 分支也只在有貼圖時混色）。
    const c = (map ? texture(map, base).rgb.mul(tint) : tint).toVar();
    if (map) c.assign(mix(c, texture(map, base.mul(0.37).add(vec2(0.31, 0.67))).rgb.mul(tint), smoothstep(0.3, 0.7, nValue(gp.mul(0.07).add(11))).mul(0.55)));
    c.mulAssign(mix(0.8, 1.16, macro));
    const groundDetail = texture(detail, uv());
    const trailHalf = sin(gp.y.mul(0.17)).mul(0.17).add(1.64);
    const trail = float(1).sub(smoothstep(trailHalf.mul(0.5), trailHalf.mul(1.05), abs(gp.x.sub(trailX(gp.y))).add(nValue(gp.mul(0.85)).sub(0.5).mul(0.7)))).mul(inWorld);
    if (key === 'forest') {
      const moss = clamp(smoothstep(0.6, 0.82, nFbm3(gp.mul(0.12).add(3.1))).add(groundDetail.g.mul(0.8)).add(creekBank.mul(0.3)), 0, 1).mul(float(1).sub(trail));
      c.assign(mix(c, vec3(0.15, 0.2, 0.07).mul(fine.mul(0.5).add(0.75)), moss.mul(0.5)));
      c.mulAssign(mix(1, 0.56, creekBank));
    }
    if (key === 'autumn') c.assign(mix(c, c.mul(vec3(1.25, 0.95, 0.62)), smoothstep(0.35, 0.75, macro).mul(0.5).add(groundDetail.b.mul(0.35))));
    if (key === 'snow') {
      c.mulAssign(mix(vec3(0.93, 0.95, 1), vec3(1), fine));
      c.assign(mix(c, c.mul(vec3(0.84, 0.87, 0.92)).mul(nValue(gp.mul(3.2)).mul(0.24).add(0.88)), trail.mul(0.85)));
    }
    if (key === 'ocean') {
      c.mulAssign(mix(1, 0.64, wetSand));
      c.assign(mix(c, c.mul(vec3(0.84, 0.9, 0.66)), smoothstep(-8, -30, gp.x).mul(smoothstep(0.4, 0.7, macro)).mul(0.6)));
    }
    if (key === 'forest' || key === 'autumn') {
      const dirt = texture(pathMap, gp.mul(0.19)).rgb.mul(glslVec3(look.trail)).mul(fine.mul(0.3).add(0.85));
      c.assign(mix(c, dirt, trail.mul(0.9)));
    }
    let farMask = smoothstep(0, 130, max(abs(gp.x), abs(gp.y)).sub(64));
    if (key === 'ocean') farMask = max(smoothstep(-40, -140, gp.x), smoothstep(3, 16, worldY)).mul(farMask);
    const canopy = mix(glslVec3(look.canopy[0]), glslVec3(look.canopy[1]), nFbm3(gp.mul(0.018))).mul(nValue(gp.mul(0.11)).mul(0.5).add(0.74));
    c.assign(mix(c, canopy, farMask.mul(Number(look.canopy[2]))));
    const steep = float(1).sub(smoothstep(0.62, 0.86, normalGeometry.y));
    c.assign(mix(c, glslVec3(look.rock).mul(fine.mul(0.4).add(0.8)), clamp(steep.mul(farMask).add(smoothstep(130, 240, worldY).mul(0.7)), 0, 1)));
    const peak = Number(look.peak);
    c.assign(mix(c, vec3(0.9, 0.93, 0.96), smoothstep(peak, peak + 50, worldY.add(macro.sub(0.5).mul(70))).mul(float(1).sub(steep.mul(0.55)))));
    return vec4(c, 1);
  })();
  if (wet) material.roughnessNode = mix(float(roughness), 0.45, wet);
  if (key === 'snow') {
    // 雪地閃光：GLSL 版加在直射高光並以直射漫射量遮去陰影處；節點材質改用自發光近似，以法線朝陽程度代替，陰影裡也會微微閃（已知差異）。
    const { u } = sky, w = positionWorld, cell = floor(w.xz.mul(26));
    const facet = normalize(vec3(nHash(cell.add(3.1)).sub(0.5), 0.55, nHash(cell.add(7.7)).sub(0.5)));
    const toSun = u.sunDirection.negate(), mirrored = toSun.sub(facet.mul(dot(toSun, facet).mul(2)));
    const glint = step(0.8, nHash(cell)).mul(pow(max(dot(mirrored, normalize(cameraPosition.sub(w))), 0), 90));
    const near = float(1).sub(smoothstep(6, 26, length(cameraPosition.sub(w))));
    const lit = clamp(max(dot(normalize(normalWorldGeometry), u.sunDirection), 0).mul(dot(u.sunLight, vec3(0.6))).div(PI), 0, 1);
    material.emissiveNode = vec3(1, 0.97, 0.92).mul(glint).mul(near).mul(9).mul(lit);
  }
  return material;
}

/* ───── 自訂效果材質（對應 shaders.js 的 ShaderMaterial）───── */

/** 林間溪水：依水深半透明，反射同一片天空。 */
export function creekMaterial(sky, { shallow, deep, bank }) {
  const { u } = sky, material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const depth = attribute('depth', 'float'), w = positionWorld;
  const flow = vec2(w.x.mul(1.6), w.z.sub(u.time.mul(0.55)).mul(0.9));
  const fineFlow = vec2(w.x.mul(3.1).add(4), w.z.sub(u.time.mul(0.85)).mul(2.3));
  const e = 0.06, h = nFbm3(flow), f = nValue(fineFlow);
  const n = normalize(vec3(
    h.sub(nFbm3(flow.add(vec2(e, 0)))).mul(2).add(f.sub(nValue(fineFlow.add(vec2(e, 0)))).mul(0.9)), 1,
    h.sub(nFbm3(flow.add(vec2(0, e)))).mul(2).add(f.sub(nValue(fineFlow.add(vec2(0, e)))).mul(0.9))));
  const V = normalize(cameraPosition.sub(w));
  const fresnel = pow(float(1).sub(max(dot(V, n), 0)), 5).mul(0.98).add(0.02);
  const R = V.negate().sub(n.mul(dot(V.negate(), n).mul(2)));
  const reflection = mix(rgb(bank), sky.sampleSky(normalize(vec3(R.x, max(R.y, 0.02), R.z))), smoothstep(0.03, 0.4, R.y));
  const deepness = smoothstep(0.02, 0.3, depth);
  const sunDot = max(dot(R, u.sunDirection), 0);
  material.colorNode = mix(mix(rgb(shallow), rgb(deep), deepness), reflection, fresnel)
    .add(u.sunLight.mul(pow(sunDot, 260).mul(4).add(pow(sunDot, 40).mul(0.12))));
  material.opacityNode = smoothstep(-0.005, 0.06, depth).mul(clamp(mix(0.5, 0.9, deepness).add(fresnel.mul(0.6)), 0, 1));
  return material;
}

/** 林間光束：沿太陽方向延伸、朝向相機的加亮薄片。 */
export function shaftMaterial(sky, color) {
  const { u } = sky, material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const cornerIn = attribute('corner', 'vec2'), shaftIn = attribute('shaft', 'vec3');
  material.positionNode = Fn(() => {
    const axis = attribute('base', 'vec3').add(u.sunDirection.mul(cornerIn.y.mul(shaftIn.y)));
    const toCamera = cameraPosition.sub(axis), dist = length(toCamera);
    const side = cross(u.sunDirection, toCamera.div(max(dist, 1e-3))), spread = length(side);
    const p = axis.add(select(spread.greaterThan(1e-4), side.div(spread), vec3(1, 0, 0)).mul(cornerIn.x.mul(shaftIn.x)));
    positionPrevious.assign(p);
    return p;
  })();
  const corner = cornerIn, shaft = shaftIn;
  const toCamera = cameraPosition.sub(positionWorld), dist = length(toCamera);
  const spread = length(cross(u.sunDirection, toCamera.div(max(dist, 1e-3))));
  const fade = smoothstep(0.08, 0.4, spread).mul(smoothstep(2, 8, dist)).mul(float(1).sub(smoothstep(48, 80, dist)));
  const across = exp(corner.x.mul(corner.x).mul(-3.4));
  const along = smoothstep(0, 0.14, corner.y).mul(float(1).sub(smoothstep(0.5, 1, corner.y)));
  const flicker = sin(u.time.mul(0.55).add(shaft.z.mul(6.283))).mul(sin(u.time.mul(0.21).add(shaft.z.mul(3.1)))).mul(0.28).add(0.72);
  const phase = pow(max(dot(toCamera.div(dist).negate(), u.sunDirection), 0), 2).mul(0.75).add(0.25);
  material.colorNode = rgb(color).mul(across.mul(along).mul(flicker).mul(phase).mul(fade).mul(DISPLAY_TO_HDR));
  return material;
}

/* 粒子：WebGPU 的點只有 1 像素，改用實例化 Sprite（PointsNodeMaterial）；位置仍全在 GPU 依時間計算、環繞相機。 */
function particleSeeds(count, rand) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  return instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 4));
}
/** 同 shaders.js 的 particleWorld：GLSL 的 mod 以 floor 取餘數（負值也落在 0..box）；明寫避免 WGSL 的 % 以截斷取餘。 */
function aroundCamera(seed, box, drift) {
  const boxSize = vec3(...box), x = seed.xyz.mul(boxSize).add(drift).sub(cameraPosition);
  return cameraPosition.add(x.sub(boxSize.mul(floor(x.div(boxSize)))).sub(boxSize.mul(0.5)));
}
function particleSprite(material, count) {
  const sprite = new THREE.Sprite(material);
  // 所有 Sprite 共用同一個模組層級幾何體；換畫質重建場景時 disposeGroup 會把它釋放，新 Sprite 便送出已銷毀的緩衝區。改用自己的副本。
  sprite.geometry = sprite.geometry.clone();
  sprite.count = count; sprite.frustumCulled = false;
  return sprite;
}
const pointSize = (size, scale, limit) => clamp(float(size).mul(scale).div(max(positionView.z.negate(), 0.1)), 1, limit).div(screenDPR);

/** 陽光中的浮塵：迎光時閃爍。 */
export function moteSprites(sky, { count, rand, color, box, size }) {
  const { u } = sky, seed = particleSeeds(count, rand), t = u.time;
  const drift = vec3(sin(t.mul(0.13).add(seed.w.mul(6.28))), sin(t.mul(0.21).add(seed.w.mul(4))).mul(0.6), cos(t.mul(0.11).add(seed.w.mul(5)))).mul(0.9);
  const material = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: false });
  const world = aroundCamera(seed, box, drift);
  material.positionNode = world;
  material.sizeNode = pointSize(size, seed.w.add(0.6).mul(u.pointScale), 5);
  const twinkle = sin(u.time.mul(seed.w.mul(2.3).add(1.1)).add(seed.w.mul(40))).mul(0.55).add(0.45);
  const phase = pow(max(dot(normalize(world.sub(cameraPosition)), u.sunDirection), 0), 3);
  const away = length(world.sub(cameraPosition));
  const alpha = twinkle.mul(phase.mul(0.82).add(0.18)).mul(smoothstep(0.6, 2.2, away))
    .mul(float(1).sub(smoothstep(box[0] * 0.32, box[0] * 0.5, length(world.xz.sub(cameraPosition.xz)))));
  const r = length(uv().sub(0.5));
  material.colorNode = rgb(color).mul(smoothstep(0.5, 0, r)).mul(alpha).mul(DISPLAY_TO_HDR);
  material.opacityNode = step(r, 0.5);
  return particleSprite(material, count);
}

/** 飄雪：環繞相機的落雪。 */
export function snowSprites(sky, { count, rand, color, box, size }) {
  const { u } = sky, seed = particleSeeds(count, rand), t = u.time, w = seed.w;
  const drift = vec3(sin(t.mul(w.mul(0.5).add(0.45)).add(w.mul(31))).mul(0.7), t.mul(w.mul(0.65).add(0.5)).negate(), cos(t.mul(w.mul(0.4).add(0.37)).add(w.mul(17))).mul(0.7));
  const material = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false });
  const world = aroundCamera(seed, box, drift);
  material.positionNode = world;
  material.sizeNode = pointSize(size, w.mul(0.9).add(0.5).mul(u.pointScale), 26);
  const alpha = smoothstep(0.25, 1.1, length(world.sub(cameraPosition))).mul(float(1).sub(smoothstep(box[0] * 0.36, box[0] * 0.5, length(world.xz.sub(cameraPosition.xz)))));
  material.colorNode = rgb(color);
  material.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(alpha).mul(0.92);
  return particleSprite(material, count);
}

/** 秋葉飄落：每片葉子各自翻轉、旋轉與左右擺盪；colors 為每片葉子的線性 RGB。 */
export function leafSprites(sky, { count, rand, colors, box, size }) {
  const { u } = sky, seed = particleSeeds(count, rand), t = u.time, w = seed.w;
  const leafColor = instancedBufferAttribute(new THREE.InstancedBufferAttribute(colors, 3));
  const drift = vec3(sin(t.mul(w.mul(0.5).add(0.6)).add(w.mul(21))).mul(1.6).add(t.mul(0.35)), t.mul(w.mul(0.6).add(0.7)).negate(), cos(t.mul(w.mul(0.4).add(0.5)).add(w.mul(13))).mul(1.2));
  const material = new THREE.PointsNodeMaterial({ alphaTest: 0.5, sizeAttenuation: false });
  material.positionNode = aroundCamera(seed, box, drift);
  material.sizeNode = pointSize(size, w.mul(0.6).add(0.7).mul(u.pointScale), 40);
  const spin = t.mul(w.mul(2.2).add(1.3)).add(w.mul(40)), c = cos(spin), s = sin(spin), turn = cos(spin.mul(0.7));
  const q = uv().sub(0.5), rx = c.mul(q.x).add(s.mul(q.y)).div(max(abs(turn), 0.22)), ry = c.mul(q.y).sub(s.mul(q.x));
  material.colorNode = leafColor.mul(turn.mul(0.3).add(0.7));
  material.opacityNode = step(length(vec2(rx, ry.mul(1.85))), 0.46);
  return particleSprite(material, count);
}

/** 海鷗：盤旋路徑與振翅全在頂點計算；前一幀位置一併算出，TAA 才不會拖影。 */
export function birdMaterial(sky, color) {
  const { u } = sky, material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const flight = attribute('flight', 'vec4'), extra = attribute('flightExtra', 'vec2');
  const placed = (local, t) => {
    const angle = extra.y.add(t.mul(flight.w).div(flight.z));
    const flap = sin(t.mul(7.5).add(extra.y.mul(9))).mul(smoothstep(-0.2, 0.6, sin(t.mul(0.5).add(extra.y.mul(3)))));
    const lx = local.x, ly = local.y.add(abs(local.x).mul(flap).mul(0.55)), lz = local.z;
    const center = vec3(flight.x, extra.x.add(sin(t.mul(0.31).add(extra.y)).mul(2.5)), flight.y);
    const radial = vec3(cos(angle), 0, sin(angle));
    const forward = normalize(vec3(sin(angle).negate(), 0, cos(angle)).mul(sign(flight.w)));
    const right = normalize(cross(forward, vec3(0, 1, 0))), up = cross(right, forward);
    const bank = sign(flight.w).mul(0.35), cb = cos(bank), sb = sin(bank);
    return center.add(radial.mul(flight.z)).add(right.mul(cb).add(up.mul(sb)).mul(lx)).add(up.mul(cb).sub(right.mul(sb)).mul(ly)).add(forward.mul(lz));
  };
  material.positionNode = Fn(() => {
    positionPrevious.assign(placed(positionGeometry, u.previousTime));
    return placed(positionGeometry, u.time);
  })();
  material.colorNode = rgb(color);
  return material;
}

/* ───── 海面 ───── */
const OCEAN_LEVEL = -0.17;
const OCEAN_WAVES = [[-0.96, -0.28, 17, 0.21], [-0.99, 0.12, 29, 0.16], [-0.82, 0.57, 9.5, 0.075], [-0.62, -0.78, 5.6, 0.035]];
const oceanFade = p => smoothstep(0.05, 2.2, max(float(OCEAN_LEVEL).sub(oceanBed(p)), 0)).mul(float(1).sub(smoothstep(160, 520, length(p.sub(cameraPosition.xz)))));
/** Gerstner 湧浪（四道，同 shaders.js 的 OCEAN_WAVES）：回傳位移與法線。 */
function oceanWaves(p, fade, time) {
  let offset = vec3(0), normal = vec3(0, 1, 0);
  for (const [dx, dz, span, amp] of OCEAN_WAVES) {
    const k = 2 * PI / span, f = p.x.mul(dx).add(p.y.mul(dz)).sub(time.mul(Math.sqrt(9.8 / k) * 0.62)).mul(k), a = fade.mul(amp);
    offset = offset.add(vec3(a.mul(cos(f)).mul(0.55 / (k * amp * 4) * dx), a.mul(sin(f)), a.mul(cos(f)).mul(0.55 / (k * amp * 4) * dz)));
    normal = normal.sub(vec3(a.mul(cos(f)).mul(dx * k), a.mul(sin(f)).mul(0.55 / (4 * amp)), a.mul(cos(f)).mul(dz * k)));
  }
  return { offset, normal: normalize(normal) };
}

/** 大西洋：Gerstner 湧浪、淺灘透出沙色、天空與夕照反射、碎浪與沖刷泡沫。 */
export function oceanMaterial(sky, { shallow, deep, foam }) {
  const { u } = sky, material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  const base = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz;
  const crest = varyingProperty('float', 'vCrest'), vBase = varying(base, 'vBase');
  material.positionNode = Fn(() => {
    const fade = oceanFade(base), now = oceanWaves(base, fade, u.time).offset;
    crest.assign(now.y);
    positionPrevious.assign(positionGeometry.add(oceanWaves(base, fade, u.previousTime).offset));
    return positionGeometry.add(now);
  })();
  const shallowColor = rgb(shallow), deepColor = rgb(deep), foamColor = rgb(foam), t = u.time;
  const w = positionWorld, p = w.xz, dist = length(cameraPosition.sub(w)), V = cameraPosition.sub(w).div(dist);
  let slope = vec2(0);
  for (let i = 0; i < 6; i++) {
    const angle = -2.6 + i * 0.95 + Math.sin(i * 3.7) * 0.4, dir = [Math.cos(angle), Math.sin(angle)], k = 2 * PI / (0.55 + i * 0.38);
    slope = slope.add(vec2(...dir).mul(cos(vBase.x.mul(dir[0]).add(vBase.y.mul(dir[1])).mul(k).sub(t.mul(Math.sqrt(9.8 * k))).add(i * 1.7)).mul(k * (0.006 + i * 0.002))));
  }
  slope = slope.div(dist.mul(0.035).add(1));
  const n = normalize(oceanWaves(vBase, oceanFade(vBase), t).normal.add(vec3(slope.x.negate(), 0, slope.y.negate())));
  const depth = max(w.y.sub(oceanBed(p)), 0);
  const fresnel = pow(float(1).sub(max(dot(n, V), 0)), 5).mul(0.98).add(0.02);
  const reflected = V.negate().sub(n.mul(dot(V.negate(), n).mul(2))), R = normalize(vec3(reflected.x, abs(reflected.y), reflected.z));
  const back = pow(max(dot(V.negate(), u.sunDirection), 0), 2);
  const body = mix(shallowColor, deepColor, smoothstep(0, 4.5, depth)).add(shallowColor.mul(max(crest, 0)).mul(back.mul(0.9).add(0.25)));
  const sunDot = max(dot(R, u.sunDirection), 0);
  const color = mix(body, sky.skyColor(R, 0, 0.6), fresnel).add(u.sunLight.mul(pow(sunDot, 900).mul(40).add(pow(sunDot, 90).mul(0.5))));
  const grain = nFbm3(p.mul(vec2(1.7, 0.9)).add(vec2(t.mul(0.06), 0)));
  const swash = sin(t.mul(0.5).add(p.y.mul(0.035))).mul(0.12).add(0.16);
  const foamShore = float(1).sub(smoothstep(swash.mul(0.4), swash, depth)).mul(smoothstep(0.3, 0.62, grain.add(0.18)));
  const wave = fract(p.x.sub(oceanShore(p.y)).div(11).add(t.mul(0.085)));
  const foamBreak = smoothstep(0, 0.035, wave).mul(float(1).sub(smoothstep(0.035, 0.17, wave))).mul(smoothstep(0.35, 1.3, depth)).mul(float(1).sub(smoothstep(2.4, 4.6, depth))).mul(smoothstep(0.42, 0.68, grain));
  const foamCrest = smoothstep(0.22, 0.36, crest).mul(smoothstep(0.55, 0.8, nValue(p.mul(0.7).add(t.mul(0.1))))).mul(float(1).sub(smoothstep(60, 220, dist)));
  const foamAmount = clamp(foamShore.add(foamBreak).add(foamCrest), 0, 1);
  const ambient = mix(sky.sampleSky(normalize(vec3(V.x.negate(), 0.04, V.z.negate()))), sky.sampleSky(vec3(0, 1, 0)), 0.4).mul(0.75);
  material.colorNode = mix(color, foamColor.mul(ambient.add(u.sunLight.mul(max(dot(n, u.sunDirection), 0)).mul(0.22))), foamAmount.mul(0.92));
  material.opacityNode = clamp(smoothstep(0, 0.75, depth).add(fresnel.mul(0.6)).add(foamAmount), 0, 1);
  return material;
}

/* ───── 渲染器與 TAA ───── */

/** three r186 每次建立貼圖視圖都帶 swizzle:'rgba'（恆等）；較舊的 Chrome（實測 141）把這個欄位當成另一種型別而拋錯。
    恆等 swizzle 拿掉不改變結果，只在這種情況下略過，讓這些版本也能走 WebGPU。 */
function tolerateIdentitySwizzle() {
  const proto = globalThis.GPUTexture?.prototype;
  if (!proto || proto.createView.__identitySwizzle) return;
  const createView = proto.createView;
  let strip = false;
  const patched = function (descriptor) {
    if (descriptor?.swizzle !== 'rgba') return createView.call(this, descriptor);
    if (!strip) {
      try { return createView.call(this, descriptor); } catch (error) {
        if (!/swizzle/i.test(error.message)) throw error;
        strip = true;
      }
    }
    const { swizzle, ...rest } = descriptor;
    return createView.call(this, rest);
  };
  patched.__identitySwizzle = true;
  proto.createView = patched;
}

export async function createRenderer(canvas) {
  tolerateIdentitySwizzle();
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  await renderer.init();
  return renderer;
}

/** 場景 pass 輸出顏色＋速度向量（MRT），交給 three 內建 TRAA；色調映射與 sRGB 由輸出階段統一處理。 */
export function createPipeline(renderer, scene, camera) {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));
  const pipeline = new THREE.RenderPipeline(renderer);
  const resolved = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
  pipeline.outputNode = resolved;
  return {
    render() { pipeline.render(); },
    dispose() { resolved.dispose?.(); scenePass.dispose?.(); pipeline.dispose?.(); },
  };
}

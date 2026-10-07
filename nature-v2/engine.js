import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from './vendor/addons/utils/BufferGeometryUtils.js';
import { createAtmosphere, addAtmosphere, skyMaterial, creekMaterial, oceanMaterial, shaftMaterial, moteMaterial, snowMaterial, fallingLeafMaterial, birdMaterial, patchFoliage, patchBark, patchRock, patchGround } from './shaders.js';
import { cutBrushes, leafBrushes, drawLeafCluster, drawPineBranch, drawPineSnow, drawPineSilhouette, drawGrass, drawFern, drawLitter, toTexture } from './foliage.js';

const SCENES = new Set(['forest', 'ocean', 'autumn', 'snow']);
// 四景都已移植到 WebGPU；保留這份清單，日後若有場景只支援 WebGL，app.js 仍會依場景選擇引擎。
export const GPU_SCENES = new Set(['forest', 'ocean', 'autumn', 'snow']);
// 葉叢改為「整簇」卡片後，近景樹冠卡片數約為舊版的四分之一；省下的預算用在遠景、光束與地被。
const TIERS = {
  high: { trees: 200, cards: 180, whorls: 12, grass: 6500, ferns: 240, farTrees: 900, shafts: 20, motes: 360, snowflakes: 2600, fallingLeaves: 240, litter: 700, shadow: 2048, shadowRadius: 2.5, ratio: 1.5, segments: 160, rings: 56, ocean: [150, 170] },
  balanced: { trees: 124, cards: 110, whorls: 9, grass: 3000, ferns: 110, farTrees: 420, shafts: 10, motes: 160, snowflakes: 1100, fallingLeaves: 110, litter: 340, shadow: 1024, shadowRadius: 1.5, ratio: 1, segments: 104, rings: 40, ocean: [100, 116] },
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const EYE_HEIGHT = 1.65;
const TAU = Math.PI * 2;

/* 四景光線與大氣。sun 為 [相機正對太陽時的 yaw, 仰角（度）]；天空、霧與光束顏色是 sRGB 顯示值。
   森林：清晨斜光穿林；海岸：低角度夕照映海；秋林：午後暖金逆光；雪林：薄日下的柔和雪光。 */
const LOOKS = {
  forest: {
    sun: [0.87, 34], sunColor: '#ffe6c0', sunIntensity: 3.5, exposure: 1.08, env: 0.9, wind: 1,
    zenith: '#5a8fc6', horizon: '#cde0e6', glow: '#ffe0b0', clouds: 0.38, skyGround: '#4a4936',
    fog: '#adc2c2', fogSun: '#f5e8c8', fogNear: 6, fogFar: 170, fogFalloff: 0.035, scatter: 0.75,
    hemi: ['#d6e6ee', '#4a4a32', 0.3], shafts: ['#fff0cc', 0.5], motes: '#fff3d0',
    ground: { tint: '#a8ae8a', trail: 'vec3( 0.78, 0.68, 0.52 )', canopy: ['vec3( 0.05, 0.085, 0.03 )', 'vec3( 0.13, 0.18, 0.06 )', '0.92'], rock: 'vec3( 0.2, 0.2, 0.19 )', peak: '310.0' },
  },
  ocean: {
    sun: [-0.74, 9], sunColor: '#ffbf7f', sunIntensity: 3.0, exposure: 1.0, env: 0.75, wind: 1.2,
    zenith: '#4a78a8', horizon: '#f0cfa2', glow: '#ffc890', clouds: 0.32, skyGround: '#7d6e55',
    fog: '#d8c9b2', fogSun: '#ffdcaa', fogNear: 25, fogFar: 520, fogFalloff: 0.012, scatter: 1.0,
    hemi: ['#c9d9e6', '#8a7a5c', 0.25],
    water: { shallow: '#648a80', deep: '#143848', foam: '#f2efe6' },
    ground: { tint: '#e7d6ba', trail: 'vec3( 1.0 )', canopy: ['vec3( 0.16, 0.19, 0.08 )', 'vec3( 0.36, 0.36, 0.2 )', '0.85'], rock: 'vec3( 0.32, 0.29, 0.25 )', peak: '9999.0' },
  },
  autumn: {
    sun: [-0.83, 20], sunColor: '#ffcc8a', sunIntensity: 3.4, exposure: 1.0, env: 0.7, wind: 1.1,
    zenith: '#5d8bbd', horizon: '#efd8b4', glow: '#ffcf95', clouds: 0.28, skyGround: '#5a4630',
    fog: '#cdb998', fogSun: '#ffd9a0', fogNear: 6, fogFar: 165, fogFalloff: 0.032, scatter: 0.9,
    hemi: ['#e6dcc8', '#5a4428', 0.26], shafts: ['#ffd9a0', 0.42], motes: '#ffe2b0',
    ground: { tint: '#a08356', trail: 'vec3( 0.85, 0.7, 0.5 )', canopy: ['vec3( 0.2, 0.08, 0.02 )', 'vec3( 0.48, 0.25, 0.05 )', '0.9'], rock: 'vec3( 0.22, 0.2, 0.18 )', peak: '330.0' },
  },
  snow: {
    sun: [-0.68, 15], sunColor: '#fff0de', sunIntensity: 1.7, exposure: 1.05, env: 0.9, wind: 0.6,
    zenith: '#8aa6c2', horizon: '#dfe7ec', glow: '#fff1dc', clouds: 0.72, skyGround: '#c9d3da',
    fog: '#d3dde3', fogSun: '#f6efe3', fogNear: 4, fogFar: 120, fogFalloff: 0.03, scatter: 0.45,
    hemi: ['#dfe9f2', '#9aa8b0', 0.35], shafts: ['#eef4ff', 0.14],
    ground: { tint: '#f1f4f4', trail: 'vec3( 1.0 )', canopy: ['vec3( 0.5, 0.55, 0.58 )', 'vec3( 0.84, 0.87, 0.9 )', '0.85'], rock: 'vec3( 0.4, 0.42, 0.45 )', peak: '120.0' },
  },
};
// 葉片調色盤（見 foliage.js 的 recolor）：秋林分為金黃與火紅兩種樹冠，避免整片同色。
const PALETTES = {
  green: [{ tint: null }, { tint: '#6f9a3c', amount: 0.45, lift: 0.15 }, { tint: '#3f6e3a', amount: 0.35 }],
  golden: [{ tint: '#ffc93a', amount: 1, lift: 0.75, shadeColor: '#3a2410' }, { tint: '#f0a83a', amount: 1, lift: 0.65, shadeColor: '#3a2410' }, { tint: '#ff8f1f', amount: 1, lift: 0.6, shadeColor: '#3a2010' }],
  fiery: [{ tint: '#ff8f1f', amount: 1, lift: 0.6, shadeColor: '#3a2010' }, { tint: '#e5481b', amount: 1, lift: 0.4, shadeColor: '#2a120a' }, { tint: '#b9281a', amount: 1, lift: 0.25, shadeColor: '#2a100a' }],
};
// 葉叢貼圖版面：每片葉約 10–15 公分，團塊留在卡片內，避免被裁成直邊。
const CLUSTER = { count: 260, radius: 0.36, leafSize: [0.07, 0.11] };
// 海岸遠景的岬角與小島：[x, z, 半徑, 高度]
const CAPES = [[480, -760, 300, 85], [260, 980, 420, 60], [1700, 350, 220, 45]];
// 海鷗剪影（翼展沿 x、前方為 +z）
const GULL = [
  0, 0, 0.42, 0.07, 0, 0, -0.07, 0, 0, 0.07, 0, 0, 0, 0, -0.34, -0.07, 0, 0,
  -0.05, 0, 0.12, -0.5, 0.05, 0.02, -0.05, 0, -0.1, -0.5, 0.05, 0.02, -0.88, -0.02, -0.16, -0.46, 0.04, -0.08,
  0.05, 0, 0.12, 0.05, 0, -0.1, 0.5, 0.05, 0.02, 0.5, 0.05, 0.02, 0.46, 0.04, -0.08, 0.88, -0.02, -0.16,
];

function randomSeed(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function pathX(z) { return Math.sin(z * 0.075) * 3.1 + Math.sin(z * 0.041) * 1.5; }
function creekX(z) { return pathX(z) + 8.4 + Math.sin(z * 0.13) * 0.8; }
function shoreline(z) { return 5.2 + Math.sin(z * 0.095) * 1.3; }

function terrainHeight(key, x, z) {
  if (key === 'ocean') {
    const edge = shoreline(z);
    return 0.74 + (edge - x) * 0.033 - Math.max(0, x - edge + 6) * 0.125
      + Math.sin(z * 0.065) * Math.sin(x * 0.07) * 0.1;
  }
  const base = Math.sin(z * 0.036) * 0.42 + Math.sin(x * 0.084) * Math.sin(z * 0.055) * 0.25;
  return key === 'forest' ? base - Math.exp(-(((x - creekX(z)) / 2.1) ** 2)) * 0.55 : base;
}

function disposeGroup(group, protectedGeometry = new Set(), protectedMaterial = new Set()) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materials.add(material);
    }
    if (object.isInstancedMesh) object.dispose();
  });
  geometries.forEach(geometry => { if (!protectedGeometry.has(geometry)) geometry.dispose(); });
  materials.forEach(material => { if (!protectedMaterial.has(material)) material.dispose(); });
}

function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm2(x, z, octaves = 4) {
  let value = 0, amplitude = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) { value += amplitude * noise2(x, z); total += amplitude; x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; amplitude *= 0.5; }
  return value / total;
}
const smooth = (edge0, edge1, x) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/** 遠景地形：世界邊界外漸起的丘陵與遠山；邊界上增量為 0，與可行走地形無縫接合。 */
function landscapeHeight(key, x, z) {
  const height = terrainHeight(key, x, z);
  const outside = Math.max(Math.abs(x) - 67, Math.abs(z) - 68, 0);
  if (outside <= 0) return height;
  if (key === 'ocean') {
    let extra = smooth(-20, -260, x) * smooth(0, 60, outside) * (8 + fbm2(x * 0.006, z * 0.006) * 46);
    for (const [cx, cz, radius, top] of CAPES) extra += smooth(radius, radius * 0.35, Math.hypot(x - cx, z - cz)) * top * (0.75 + fbm2(x * 0.012 + 3, z * 0.012) * 0.5);
    return height + extra;
  }
  const hills = smooth(0, 170, outside) * (6 + fbm2(x * 0.0055 + 3.7, z * 0.0055 - 1.3) * 52);
  const ridge = 1 - Math.abs(fbm2(x * 0.0012 - 5.2, z * 0.0012 + 2.4) * 2 - 1);
  return height + hills + smooth(650, 1500, Math.hypot(x, z)) * ridge ** 1.6 * (key === 'snow' ? 380 : 330);
}

function randomDirection(rand, target = new THREE.Vector3()) {
  const y = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(1 - y * y);
  return target.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** 真實地形上的第一人稱探索；介面僅處理移動與渲染，降級選擇由使用者介面負責。
    gpu 為 gpu.js 模組時改用 WebGPU 渲染器、TSL 材質、物理天空與 TAA（僅限 GPU_SCENES）。 */
export async function createExplorer({ canvas, scene: initialScene = 'forest', quality = 'high', gpu = null, onStats = () => {}, onFailure = () => {} }) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('探索畫布不存在。');
  if (!SCENES.has(initialScene)) throw new RangeError('不支援這個自然場景。');
  if (gpu && !GPU_SCENES.has(initialScene)) throw new RangeError('WebGPU 試點尚未支援這個自然場景。');
  if (!TIERS[quality]) throw new RangeError('不支援這個畫質。');

  let disposed = false;
  let failed = false;
  let running = true;
  let currentScene = initialScene;
  let currentQuality = quality;
  let frame = null;
  let lastTime = 0;
  let clockTime = 0;
  let distance = 0;
  let statsTime = 0;
  let statsFrames = 0;
  let yaw = 0;
  let pitch = -0.015;
  let world = null;
  let collision = [];
  let particles = [];
  let transientTextures = [];
  let envTarget = null;
  let brushes = null;
  const brushCache = new Map();
  const textures = new Map();
  const modelGeometries = new Set(), modelMaterials = new Set(), modelTextures = new Set();
  const models = new Map();
  const atmo = createAtmosphere();
  const input = { forward: false, backward: false, left: false, right: false };
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  function onMotionPreference(event) {
    reducedMotion = event.matches;
    particles.forEach(mesh => { mesh.visible = !reducedMotion; });
    if (!running) draw();
  }
  motionPreference.addEventListener('change', onMotionPreference);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 4000);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();
  const fog = new THREE.Fog('#ffffff', 10, 200);
  scene.fog = fog;
  const envScene = new THREE.Scene();

  const fail = reason => {
    if (disposed || failed) return;
    failed = true;
    running = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    onFailure(reason instanceof Error ? reason.message : String(reason));
  };
  let renderer;
  try {
    renderer = gpu ? await gpu.createRenderer(canvas) : new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    onFailure(`這個裝置無法啟動 3D：${error.message}`);
    throw error;
  }
  const backend = gpu ? (renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2-node') : 'webgl';
  if (gpu) renderer.info.autoReset = false; // 一幀有場景、TAA、輸出數次 render，改為每幀手動歸零才看得到整幀的 draw calls
  const maxAnisotropy = gpu ? renderer.getMaxAnisotropy() : renderer.capabilities.getMaxAnisotropy();
  const sky3d = gpu ? gpu.createGpuAtmosphere(atmo) : null;
  const pipeline = gpu ? gpu.createPipeline(renderer, scene, camera) : null;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  if (gpu) renderer.onDeviceLost = info => fail(`圖形裝置中斷（${info?.message || '未提供原因'}），請改用輕量版或重新載入。`);
  else renderer.debug.onShaderError = (gl, program) => fail(`3D 材質編譯失敗：${gl.getProgramInfoLog(program) || '裝置未提供詳細訊息'}`);
  const onContextLost = event => { event.preventDefault(); fail('圖形裝置中斷，請改用輕量版或重新載入。'); };
  canvas.addEventListener('webglcontextlost', onContextLost);

  const sunlight = new THREE.DirectionalLight('#fff0d6', 3.2);
  sunlight.castShadow = true;
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -32;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 32;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 170;
  sunlight.shadow.bias = -0.0004;
  sunlight.shadow.normalBias = 0.045;
  if (gpu) sunlight.shadow.autoUpdate = false; // WebGPU 渲染器以各光源的 shadow.needsUpdate 控制重畫
  const hemisphere = new THREE.HemisphereLight('#e3eff8', '#414431', 0.3);
  scene.add(sunlight, sunlight.target, hemisphere);
  const pmrem = gpu ? new gpu.THREE.PMREMGenerator(renderer) : new THREE.PMREMGenerator(renderer);

  function resize() {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[currentQuality].ratio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    atmo.pointScale.value = height * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (!running && world && !failed) draw();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const loader = new THREE.TextureLoader();
  try {
    await Promise.all(['ground', 'bark', 'rock', 'sand'].flatMap(name => [name, `${name}-normal`]).map(async name => {
      const texture = await loader.loadAsync(`./assets/pbr/${name}.jpg`);
      texture.colorSpace = name.endsWith('-normal') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(maxAnisotropy, 8);
      if (name.startsWith('ground')) texture.repeat.set(26, 26);
      if (name.startsWith('bark')) texture.repeat.set(1.2, 4.2);
      if (name.startsWith('rock')) texture.repeat.set(1.25, 1.25);
      if (name.startsWith('sand')) texture.repeat.set(22, 22);
      textures.set(name, texture);
    }));
    const imageLoader = new THREE.ImageLoader();
    const [leaf, leafAlpha, twig, twigAlpha] = await Promise.all(['leaf.jpg', 'leaf-alpha.png', 'twig.jpg', 'twig-alpha.jpg'].map(name => imageLoader.loadAsync(`./assets/pbr/${name}`)));
    brushes = cutBrushes({ leaf, leafAlpha, twig, twigAlpha });
    const gltfLoader = new GLTFLoader();
    await Promise.all(['rock_moss_set_01', 'tree_stump_01'].map(async name => {
      const gltf = await gltfLoader.loadAsync(`./assets/models/${name}/${name}_1k.gltf`);
      const meshes = [];
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox, center = bounds.getCenter(new THREE.Vector3());
        object.geometry.translate(-center.x, -bounds.min.y, -center.z);
        object.geometry.computeBoundingBox();
        modelGeometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          modelMaterials.add(material);
          material.envMapIntensity = 0.95;
          material.onBeforeCompile = shader => addAtmosphere(shader, atmo);
          for (const value of Object.values(material)) if (value?.isTexture) {
            value.anisotropy = Math.min(maxAnisotropy, 8); modelTextures.add(value);
          }
        }
        meshes.push(object);
      });
      if (!meshes.length) throw new Error(`掃描模型 ${name} 沒有可繪製的網格。`);
      models.set(name, meshes);
    }));
  } catch (error) {
    textures.forEach(texture => texture.dispose());
    modelGeometries.forEach(geometry => geometry.dispose()); modelMaterials.forEach(material => material.dispose()); modelTextures.forEach(texture => texture.dispose());
    resizeObserver.disconnect();
    motionPreference.removeEventListener('change', onMotionPreference);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    sky3d?.dispose(); pipeline?.dispose(); pmrem.dispose(); renderer.dispose();
    onFailure('自然材質載入失敗，請確認網路後重新載入，或改用輕量版。');
    throw error;
  }

  const transform = new THREE.Object3D();
  function instance(mesh, index, position, scale, rotation, color) {
    transform.position.copy(position);
    transform.scale.copy(scale);
    if (rotation?.isQuaternion) transform.quaternion.copy(rotation);
    else transform.rotation.set(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    if (color) mesh.setColorAt(index, color);
  }
  function finishInstances(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    world.add(mesh);
  }
  function cylinderInstance(mesh, index, start, end, radius) {
    const direction = end.clone().sub(start);
    instance(mesh, index, start.clone().add(end).multiplyScalar(0.5), new THREE.Vector3(radius, direction.length(), radius), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize()));
  }
  // onBeforeCompile 的程式快取鍵預設是函式原始碼；包裝後原始碼相同，須明確給定不同的鍵。
  function patched(material, cacheKey, patch) {
    material.onBeforeCompile = patch;
    material.customProgramCacheKey = () => cacheKey;
    return material;
  }
  const sceneDefine = key => ({ [`SCENE_${key.toUpperCase()}`]: '' });
  // WebGPU 路徑：同樣的參數建立節點材質，霧由場景的 fogNode 統一處理，不需逐材質修補。
  const StandardMaterial = gpu ? gpu.MeshStandardNodeMaterial : THREE.MeshStandardMaterial;
  function standard(map, color = '#ffffff', extra = {}) {
    const material = new StandardMaterial({
      color, map: map ? textures.get(map) : null, normalMap: map ? textures.get(`${map}-normal`) : null,
      normalScale: new THREE.Vector2(0.65, 0.65), roughness: 0.95, metalness: 0, envMapIntensity: 0.8, ...extra,
    });
    return gpu ? material : patched(material, 'atmosphere', shader => addAtmosphere(shader, atmo));
  }
  function foliageMaterial(map, options, extra = {}) {
    const material = new StandardMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.9, ...extra });
    if (gpu) return gpu.patchFoliage(material, sky3d, options);
    return patched(material, `foliage:${JSON.stringify(options)}`, shader => patchFoliage(shader, atmo, options));
  }
  function texture(canvasElement) {
    const result = toTexture(canvasElement, Math.min(maxAnisotropy, 4));
    transientTextures.push(result);
    return result;
  }
  function brushSet(name) {
    if (!brushCache.has(name)) brushCache.set(name, leafBrushes(brushes.leaves, PALETTES[name]));
    return brushCache.get(name);
  }
  const displayColor = (value, scale = 1) => new THREE.Color().setStyle(value, THREE.LinearSRGBColorSpace).multiplyScalar(scale);

  function applyLook(key, tier) {
    const look = LOOKS[key], [sunYaw, elevation] = look.sun, e = THREE.MathUtils.degToRad(elevation);
    atmo.sunDirection.value.set(-Math.sin(sunYaw) * Math.cos(e), Math.sin(e), -Math.cos(sunYaw) * Math.cos(e)).normalize();
    sunlight.color.set(look.sunColor); sunlight.intensity = look.sunIntensity;
    atmo.sunLight.value.copy(sunlight.color).multiplyScalar(look.sunIntensity);
    for (const [name, value] of [['skyZenith', look.zenith], ['skyHorizon', look.horizon], ['skyGlow', look.glow], ['skyGround', look.skyGround], ['hazeColor', look.fog], ['fogSunColor', look.fogSun]]) {
      atmo[name].value.setStyle(value, THREE.LinearSRGBColorSpace);
    }
    atmo.fogHeight.value.set(0, look.fogFalloff, look.scatter);
    atmo.cloudCover.value = look.clouds;
    atmo.wind.value = look.wind;
    fog.color.set(look.fog); fog.near = look.fogNear; fog.far = look.fogFar;
    sky3d?.u.fogRange.value.set(look.fogNear, look.fogFar);
    hemisphere.color.set(look.hemi[0]); hemisphere.groundColor.set(look.hemi[1]); hemisphere.intensity = look.hemi[2];
    renderer.toneMappingExposure = look.exposure;
    scene.environmentIntensity = look.env;
    sunlight.shadow.mapSize.set(tier.shadow, tier.shadow);
    sunlight.shadow.radius = tier.shadowRadius;
    // WebGPU 的陰影節點自己持有陰影圖並依 mapSize 調整尺寸；外部釋放會讓它送出已銷毀的緩衝區。
    if (!gpu && sunlight.shadow.map) { sunlight.shadow.map.dispose(); sunlight.shadow.map = null; }
  }

  /** 天空穹頂，並以同一片天空烘出環境光（PMREM），讓地面、岩石與水面的反光和天色一致。 */
  function sky() {
    if (gpu) {
      sky3d.bake(renderer);
      if (envTarget) envTarget.dispose();
      envTarget = gpu.installSky(renderer, scene, sky3d, pmrem);
      scene.environment = envTarget.texture;
      return;
    }
    const geometry = new THREE.SphereGeometry(10, 48, 24), material = skyMaterial(atmo);
    const dome = new THREE.Mesh(geometry, material);
    dome.frustumCulled = false; dome.renderOrder = 1;
    world.add(dome);
    const probe = new THREE.Mesh(geometry, material);
    probe.frustumCulled = false;
    envScene.add(probe);
    // 新配置的渲染目標深度未必已清除，烘焙時關閉深度測試。
    material.depthTest = false; atmo.envPass.value = 1;
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
    material.depthTest = true; atmo.envPass.value = 0;
    envScene.remove(probe);
    scene.environment = envTarget.texture;
  }

  /** 地面細節圖（覆蓋可行走範圍）：R 遮蔽、G 苔蘚、B 落葉；同時作為地表材質的 aoMap。 */
  function groundDetail() {
    const size = 512, detailCanvas = document.createElement('canvas');
    detailCanvas.width = detailCanvas.height = size;
    const context = detailCanvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#000'; context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'lighter';
    const detailTexture = new THREE.CanvasTexture(detailCanvas);
    detailTexture.colorSpace = THREE.NoColorSpace;
    detailTexture.wrapS = detailTexture.wrapT = THREE.ClampToEdgeWrapping;
    transientTextures.push(detailTexture);
    const mark = (x, z, radius, [r, g, b]) => {
      const px = (x + 67) / 134 * size, py = (z + 68) / 136 * size, pr = Math.max(1.5, radius / 134 * size);
      const gradient = context.createRadialGradient(px, py, 0, px, py, pr);
      gradient.addColorStop(0, `rgb(${r},${g},${b})`); gradient.addColorStop(1, 'rgb(0,0,0)');
      context.fillStyle = gradient;
      context.beginPath(); context.arc(px, py, pr, 0, TAU); context.fill();
    };
    const finish = () => {
      context.globalCompositeOperation = 'source-over';
      const image = context.getImageData(0, 0, size, size);
      for (let i = 0; i < image.data.length; i += 4) image.data[i] = 255 - image.data[i];
      context.putImageData(image, 0, 0);
      // 外圍地形夾取邊緣像素：保持一圈「無遮蔽」。
      context.strokeStyle = 'rgb(255,0,0)'; context.lineWidth = 6; context.strokeRect(0, 0, size, size);
      detailTexture.needsUpdate = true;
    };
    return { texture: detailTexture, mark, finish };
  }

  function groundMaterial(key, detailTexture) {
    const look = LOOKS[key].ground, snow = key === 'snow', sand = key === 'ocean';
    const material = new StandardMaterial({
      color: '#ffffff', map: snow ? null : textures.get(sand ? 'sand' : 'ground'), normalMap: textures.get(sand ? 'sand-normal' : 'ground-normal'),
      normalScale: new THREE.Vector2(snow ? 0.25 : 0.7, snow ? 0.25 : 0.7), roughness: snow ? 0.8 : 0.95, metalness: 0, vertexColors: true, envMapIntensity: 1,
      aoMap: detailTexture, aoMapIntensity: 1,
    });
    if (gpu) return gpu.patchGround(material, look, { map: material.map, detail: detailTexture, pathMap: textures.get('sand'), repeat: sand ? 22 : 26, key, sky: sky3d });
    material.defines = { ...sceneDefine(key), TRAIL_TINT: look.trail, CANOPY_DARK: look.canopy[0], CANOPY_LIGHT: look.canopy[1], CANOPY_AMOUNT: look.canopy[2], ROCK_TINT: look.rock, PEAK_SNOW: look.peak };
    return patched(material, 'ground', shader => patchGround(shader, atmo, textures.get('sand')));
  }

  /** 頂點色與解析法線：兩塊地形以同一高度函式求法線，接縫處光影連續。 */
  function groundAttributes(geometry, key) {
    const positions = geometry.attributes.position, colors = new Float32Array(positions.count * 3), normals = new Float32Array(positions.count * 3);
    const tint = new THREE.Color(LOOKS[key].ground.tint), color = new THREE.Color(), normal = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), e = Math.max(0.45, Math.hypot(x, z) * 0.008);
      color.copy(tint).multiplyScalar(0.94 + Math.sin(x * 0.29) * Math.cos(z * 0.36) * 0.035);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      normal.set((landscapeHeight(key, x - e, z) - landscapeHeight(key, x + e, z)) / (2 * e), 1, (landscapeHeight(key, x, z - e) - landscapeHeight(key, x, z + e)) / (2 * e)).normalize();
      normals[i * 3] = normal.x; normals[i * 3 + 1] = normal.y; normals[i * 3 + 2] = normal.z;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  }

  function terrain(key, tier, detailTexture) {
    const material = groundMaterial(key, detailTexture);
    const inner = new THREE.PlaneGeometry(134, 136, tier.segments, tier.segments);
    inner.rotateX(-Math.PI / 2);
    const positions = inner.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, terrainHeight(key, positions.getX(i), positions.getZ(i)));
    groundAttributes(inner, key);
    // 遠景環帶：沿可行走地形邊界的同一組頂點向外放射，最外圈約 3.2 公里，接縫完全密合。
    const segments = tier.segments, sx = 134 / segments, sz = 136 / segments, loop = [];
    for (let i = 0; i < segments; i++) loop.push([i * sx - 67, 0 * sz - 68]);
    for (let j = 0; j < segments; j++) loop.push([segments * sx - 67, j * sz - 68]);
    for (let i = segments; i > 0; i--) loop.push([i * sx - 67, segments * sz - 68]);
    for (let j = segments; j > 0; j--) loop.push([0 * sx - 67, j * sz - 68]);
    const vertices = [], uvs = [], indices = [], count = loop.length, rings = tier.rings;
    for (let k = 0; k <= rings; k++) {
      for (const [bx, bz] of loop) {
        const ex = Math.fround(bx), ez = Math.fround(bz), base = Math.hypot(ex, ez);
        const scale = k ? Math.pow(3200 / base, Math.pow(k / rings, 1.35)) : 1;
        const x = ex * scale, z = ez * scale;
        vertices.push(x, k ? landscapeHeight(key, x, z) : terrainHeight(key, x, z), z);
        uvs.push(0.5 + x / 134, 0.5 - z / 136);
      }
      if (k < rings) for (let i = 0; i < count; i++) {
        const a = k * count + i, b = k * count + (i + 1) % count;
        indices.push(a, b, a + count, b, b + count, a + count);
      }
    }
    const outer = new THREE.BufferGeometry();
    outer.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    outer.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    outer.setIndex(indices);
    groundAttributes(outer, key);
    for (const geometry of [inner, outer]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      world.add(mesh);
    }
  }

  function placeTrees(key, tier, rand) {
    const pine = key === 'snow';
    const placements = [];
    for (let i = 0; i < tier.trees; i++) {
      let x, z;
      do {
        z = (rand() - 0.5) * 118;
        x = pathX(z) + (rand() - 0.5) * (rand() < 0.78 ? 38 : 96);
      }
      while (Math.abs(x) > 60 || Math.abs(x - pathX(z)) < 3.35 || (key === 'forest' && Math.abs(x - creekX(z)) < 1.8));
      const young = !pine && rand() < 0.2;
      placements.push({ x, z, y: terrainHeight(key, x, z), height: young ? 4.4 + rand() * 3.8 : (pine ? 8.1 : 8.7) + rand() * 9.3, radius: young ? 0.09 + rand() * 0.11 : 0.17 + rand() ** 1.8 * 0.48, angle: rand() * TAU, young });
    }
    // 固定前景樹把視線引導到彎曲小徑，遠近層次由真實相機視差形成。
    placements[0] = { x: pathX(27) - 3.5, z: 27, y: terrainHeight(key, pathX(27) - 3.5, 27), height: 13, radius: 0.48, angle: 0.3, young: false };
    placements[1] = { x: pathX(20) + 4.5, z: 20, y: terrainHeight(key, pathX(20) + 4.5, 20), height: 16, radius: 0.55, angle: 1.5, young: false };
    return placements;
  }

  /** 近景樹：闊葉樹以數個葉團組成不規則樹冠；松樹為層層下垂的枝葉，雪林再覆上積雪。 */
  function forestTrees(key, tier, rand, placements, mark) {
    const pine = key === 'snow', barkColor = pine ? '#8f887a' : '#c2b6a2';
    const trunkMaterial = gpu ? gpu.patchBark(standard('bark', barkColor), key) : patched(standard('bark', barkColor), 'bark', shader => patchBark(shader, atmo));
    if (!gpu) trunkMaterial.defines = sceneDefine(key);
    const trunkGeometry = new THREE.CylinderGeometry(pine ? 0.18 : 0.46, 1, 1, 14, 12);
    const trunkPositions = trunkGeometry.attributes.position;
    for (let i = 0; i < trunkPositions.count; i++) {
      const y = trunkPositions.getY(i) + 0.5, flare = 1 + Math.max(0, 0.06 - y) / 0.06 * 0.55;
      trunkPositions.setX(i, trunkPositions.getX(i) * flare + (pine ? 0 : Math.sin(y * 3.8) * y * 0.12));
      trunkPositions.setZ(i, trunkPositions.getZ(i) * flare + (pine ? 0 : Math.sin(y * 4.9 + 0.8) * y * 0.13));
    }
    trunkGeometry.computeVertexNormals();
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, placements.length);
    trunks.castShadow = trunks.receiveShadow = true;
    const branchCapacity = placements.length * (pine ? 64 : 14);
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 1, 1, 7), standard('bark', barkColor), branchCapacity);
    branches.castShadow = branches.receiveShadow = true;
    let branchIndex = 0;
    const branch = (start, end, radius) => { if (branchIndex < branchCapacity) cylinderInstance(branches, branchIndex++, start, end, radius); };

    const maps = pine ? [texture(drawPineBranch(brushes.twig, rand))]
      : key === 'autumn' ? [texture(drawLeafCluster(brushSet('golden'), rand, CLUSTER)), texture(drawLeafCluster(brushSet('fiery'), rand, CLUSTER))]
        : [texture(drawLeafCluster(brushSet('green'), rand, CLUSTER))];
    const cardsPerTree = pine ? (tier.whorls + 2) * 6 * 2 : tier.cards;
    const weight = pine ? 'clamp( ( mvPosition.y - 2.0 ) * 0.004, 0.0, 0.06 )' : 'clamp( ( mvPosition.y - 2.0 ) * 0.0055, 0.0, 0.1 )';
    const cardSet = (map, capacity, options, extra) => {
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.setAttribute('crownNormal', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
      const mesh = new THREE.InstancedMesh(geometry, foliageMaterial(map, options, extra), capacity);
      mesh.castShadow = mesh.receiveShadow = true;
      return { mesh, normals: geometry.attributes.crownNormal, index: 0, capacity };
    };
    const crowns = maps.map(map => cardSet(map, placements.length * cardsPerTree, { weight, crown: true, translucency: pine ? 0.12 : 0.32 }, { roughness: pine ? 0.9 : 0.8 }));
    const snowCaps = pine ? cardSet(texture(drawPineSnow(rand)), placements.length * (tier.whorls + 2) * 6, { weight, crown: true }, { roughness: 0.75, color: '#f4f8fa' }) : null;
    const addCard = (set, position, scale, rotation, normal, color) => {
      if (set.index >= set.capacity) return;
      instance(set.mesh, set.index, position, scale, rotation, color);
      set.normals.setXYZ(set.index, normal.x, normal.y, normal.z);
      set.index++;
    };

    const color = new THREE.Color(), normal = new THREE.Vector3(), direction = new THREE.Vector3(), facing = new THREE.Vector3(), spin = new THREE.Vector3();
    const quaternion = new THREE.Quaternion(), roll = new THREE.Quaternion(), basis = new THREE.Matrix4(), white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < placements.length; i++) {
      const tree = placements[i], { x, y, z, height: h, radius: r, angle } = tree;
      collision.push({ x, z, r: r + 0.38 });
      const trunkHeight = h * (pine ? 0.97 : 0.86);
      instance(trunks, i, new THREE.Vector3(x, y + trunkHeight * 0.5, z), new THREE.Vector3(r, trunkHeight, r), new THREE.Euler((rand() - 0.5) * 0.024, angle, (rand() - 0.5) * 0.03));
      mark(x, z, r * 3 + 1.1, [115, key === 'forest' ? 150 : 0, 0]);
      for (let b = 0; b < 5; b++) {
        const a = angle + b * Math.PI * 0.4;
        branch(new THREE.Vector3(x, y + 0.1, z), new THREE.Vector3(x + Math.cos(a) * r * 2.4, y - 0.1, z + Math.sin(a) * r * 2.4), r * 0.47);
      }
      if (pine) {
        const whorls = tier.whorls + Math.floor(rand() * 3) - 1, maxReach = 2.1 + h * 0.085 + rand() * 0.4;
        const crown = crowns[0], start = new THREE.Vector3();
        mark(x, z, maxReach * 1.1, [55, 0, 0]);
        for (let level = 0; level < whorls; level++) {
          const t = level / (whorls - 1), reach = maxReach * Math.pow(1 - t, 1.1) + 0.3, arms = 5 + (rand() < 0.45 ? 1 : 0);
          start.set(x, y + h * (0.18 + t * 0.78), z);
          for (let arm = 0; arm < arms; arm++) {
            const a = angle + arm * TAU / arms + level * 0.61 + (rand() - 0.5) * 0.45;
            direction.set(Math.cos(a), -(0.26 + rand() * 0.14) + t * 0.18, Math.sin(a)).normalize();
            let armReach = reach;
            // 視線高度的低枝避開步道，免得枝葉貼在鏡頭前。
            while (start.y - y < 3.4 && armReach > 0.8 && Math.abs(start.x + direction.x * armReach - pathX(start.z + direction.z * armReach)) < 2.3) armReach *= 0.8;
            const tip = start.clone().addScaledVector(direction, armReach);
            if (t < 0.5) branch(start, tip.clone().lerp(start, 0.45), r * (0.16 - t * 0.12));
            const length = armReach;
            const side = new THREE.Vector3().crossVectors(Y_AXIS, direction).normalize();
            const up = new THREE.Vector3().crossVectors(direction, side).normalize();
            const middle = start.clone().lerp(tip, 0.52);
            quaternion.setFromRotationMatrix(basis.makeBasis(direction, side, up));
            quaternion.premultiply(roll.setFromAxisAngle(direction, (rand() - 0.5) * 0.5));
            normal.set(direction.x, 0.65, direction.z).normalize();
            color.setScalar(0.74 + 0.26 * t + rand() * 0.12);
            addCard(crown, middle, new THREE.Vector3(length * 1.08, length * 0.66, 1), quaternion, normal, color);
            {
              const tilted = quaternion.clone().premultiply(roll.setFromAxisAngle(direction, rand() < 0.5 ? -1.1 : 1.1));
              addCard(crown, middle.clone().addScaledVector(up, -0.08), new THREE.Vector3(length * 0.98, length * 0.55, 1), tilted, normal, color);
            }
            if (snowCaps) addCard(snowCaps, middle.clone().addScaledVector(up, 0.07), new THREE.Vector3(length * 1.0, length * 0.62, 1), quaternion, new THREE.Vector3(direction.x * 0.3, 1, direction.z * 0.3).normalize(), white);
          }
        }
        quaternion.setFromRotationMatrix(basis.makeBasis(Y_AXIS, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)));
        addCard(crown, new THREE.Vector3(x, y + h * 0.95, z), new THREE.Vector3(1.7, 0.75, 1), quaternion, normal.set(0, 1, 0), color.setScalar(1));
      } else {
        const crown = crowns[Math.floor(rand() * crowns.length)];
        const center = new THREE.Vector3(x, y + h * (tree.young ? 0.64 : 0.7), z);
        const rx = THREE.MathUtils.clamp(h * 0.21, 1.4, 3.8), ry = h * 0.23;
        const lobes = [], lobeCount = tree.young ? 3 : 4 + Math.floor(rand() * 3);
        for (let l = 0; l < lobeCount; l++) {
          const a = angle + l * TAU / lobeCount + (rand() - 0.5) * 0.7;
          lobes.push({ center: new THREE.Vector3(center.x + Math.cos(a) * rx * 0.5, center.y + (rand() - 0.4) * ry * 0.7, center.z + Math.sin(a) * rx * 0.5), radius: rx * (0.52 + rand() * 0.18) });
          branch(new THREE.Vector3(x, y + h * (0.4 + rand() * 0.2), z), lobes[l].center, r * (0.18 + rand() * 0.1));
        }
        lobes.push({ center: new THREE.Vector3(center.x + (rand() - 0.5) * 0.6, center.y + ry * 0.62, center.z + (rand() - 0.5) * 0.6), radius: rx * 0.56 });
        mark(center.x, center.z, rx * 1.15, [48, 0, key === 'autumn' ? 140 : 0]);
        const volume = lobes.reduce((sum, lobe) => sum + lobe.radius ** 3, 0), total = Math.round(cardsPerTree * (tree.young ? 0.55 : 1));
        const warm = rand(), tint = key === 'autumn' ? [1, 0.96 + warm * 0.08, 0.92 + warm * 0.1] : [0.95 + warm * 0.11, 1, 0.92 - warm * 0.1];
        const scaleFactor = THREE.MathUtils.clamp(h / 14, 0.72, 1.15), brightness = 0.9 + rand() * 0.2;
        for (const lobe of lobes) {
          const count = Math.max(3, Math.round(total * lobe.radius ** 3 / volume));
          for (let k = 0; k < count; k++) {
            randomDirection(rand, direction);
            const distanceFromLobe = lobe.radius * (0.2 + 0.8 * Math.cbrt(rand()));
            const p = lobe.center.clone().addScaledVector(direction, distanceFromLobe);
            p.y -= direction.y * distanceFromLobe * 0.15;
            const size = (1.15 + rand() * 0.7) * scaleFactor;
            normal.set((p.x - center.x) / (rx * rx), (p.y - center.y) / (ry * ry) + 0.25 / ry, (p.z - center.z) / (rx * rx)).normalize();
            const light = (0.58 + 0.42 * smooth(0.25, 1, p.distanceTo(center) / rx) + 0.12 * (p.y - center.y) / ry) * brightness;
            color.setRGB(light * tint[0], light * tint[1], light * tint[2]);
            facing.copy(normal).addScaledVector(randomDirection(rand, spin), 0.85).normalize();
            quaternion.setFromUnitVectors(Z_AXIS, facing).multiply(roll.setFromAxisAngle(Z_AXIS, rand() * TAU));
            addCard(crown, p, new THREE.Vector3(size, size, 1), quaternion, normal, color);
          }
        }
      }
    }
    branches.count = branchIndex;
    finishInstances(trunks); finishInstances(branches);
    for (const set of [...crowns, snowCaps]) {
      if (!set) continue;
      set.mesh.count = set.index;
      set.normals.needsUpdate = true;
      finishInstances(set.mesh);
    }
  }

  /** 世界邊界外的林帶：交叉卡片樹（球面法線），由近到遠漸疏，銜接遠山林相。 */
  function farForest(key, tier, rand) {
    const pine = key === 'snow', ocean = key === 'ocean';
    const count = ocean ? Math.round(tier.farTrees * 0.3) : tier.farTrees;
    const planes = (pine ? [0, Math.PI / 2] : [0, Math.PI / 3, Math.PI * 2 / 3]).map(a => { const plane = new THREE.PlaneGeometry(1, 1); plane.translate(0, 0.5, 0); plane.rotateY(a); return plane; });
    const geometry = mergeGeometries(planes);
    planes.forEach(plane => plane.dispose());
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, n = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      n.set(positions.getX(i), pine ? 0.5 : positions.getY(i) - 0.45, positions.getZ(i)).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
    const map = pine ? texture(drawPineSilhouette(rand, { snowy: true, width: 192, height: 384 }))
      : texture(drawLeafCluster(key === 'autumn' ? [...brushSet('golden'), ...brushSet('fiery')] : brushSet('green'), rand, { size: 256, count: 300, radius: 0.36, leafSize: [0.07, 0.1], twigs: 0, lumps: 5 }));
    const crowns = new THREE.InstancedMesh(geometry, foliageMaterial(map, { weight: '0.0' }, { roughness: 0.9, envMapIntensity: 0.8 }), count);
    crowns.receiveShadow = true;
    const trunks = pine || ocean ? null : new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1, 1, 5, 1, true), standard(null, '#4a3b2c', { roughness: 1 }), count);
    const color = new THREE.Color();
    let placed = 0;
    for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
      const a = rand() * TAU, d = 60 + Math.pow(rand(), 1.7) * 230, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) < 59 || (ocean && x > -55)) continue;
      const ground = landscapeHeight(key, x, z), h = pine ? 12 + rand() * 9 : ocean ? 1.6 + rand() * 2.4 : 11 + rand() * 9;
      const w = pine ? h * 0.42 : ocean ? h * (1.3 + rand() * 0.5) : h * (0.55 + rand() * 0.2), turn = rand() * TAU;
      color.setScalar((ocean ? 0.7 : 0.82) + rand() * 0.3);
      if (pine || ocean) instance(crowns, placed, new THREE.Vector3(x, ground - 0.3, z), new THREE.Vector3(w, h, w), new THREE.Euler(0, turn, 0), color);
      else {
        instance(crowns, placed, new THREE.Vector3(x, ground + h * 0.14, z), new THREE.Vector3(w, h * 0.88, w), new THREE.Euler(0, turn, 0), color);
        instance(trunks, placed, new THREE.Vector3(x, ground + h * 0.15, z), new THREE.Vector3(h * 0.014, h * 0.32, h * 0.014), new THREE.Euler(0, turn, 0));
      }
      placed++;
    }
    crowns.count = placed;
    finishInstances(crowns);
    if (trunks) { trunks.count = placed; finishInstances(trunks); }
  }

  function scannedDetails(key, rand, mark) {
    const rockSources = models.get('rock_moss_set_01');
    const countPerShape = currentQuality === 'high' ? 3 : 1;
    rockSources.forEach((source, shape) => {
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, countPerShape);
      mesh.castShadow = currentQuality === 'high'; mesh.receiveShadow = true;
      for (let i = 0; i < countPerShape; i++) {
        const z = 18 - shape * 7.1 - i * 21 + (rand() - 0.5) * 2;
        const x = key === 'ocean' ? shoreline(z) + 1.8 : creekX(z) + (shape % 2 ? -2 : 2) * (2 + rand());
        const scale = 0.62 + rand() * 0.5;
        instance(mesh, i, new THREE.Vector3(x, terrainHeight(key, x, z) - 0.06, z), new THREE.Vector3(scale, scale, scale), new THREE.Euler(0, rand() * Math.PI * 2, 0));
        collision.push({ x, z, r: scale * 0.78 + 0.35 });
        mark(x, z, scale * 1.6 + 0.4, [110, key === 'forest' ? 90 : 0, 0]);
      }
      finishInstances(mesh);
    });
    if (key === 'ocean' || key === 'snow') return;
    const source = models.get('tree_stump_01')[0];
    const count = currentQuality === 'high' ? 3 : 1;
    const stumps = new THREE.InstancedMesh(source.geometry, source.material, count);
    stumps.castShadow = currentQuality === 'high'; stumps.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const z = i === 0 ? 27 : i === 1 ? 20 : 7;
      const x = pathX(z) + (i === 1 ? 4.5 : -3.5);
      const scale = i === 0 ? 1.04 : 0.78;
      instance(stumps, i, new THREE.Vector3(x, terrainHeight(key, x, z) - 0.04, z), new THREE.Vector3(scale, scale, scale), new THREE.Euler(0, rand() * Math.PI * 2, 0));
      collision.push({ x, z, r: scale * 0.8 + 0.25 });
      mark(x, z, scale * 1.8 + 0.5, [100, key === 'forest' ? 120 : 0, 0]);
    }
    finishInstances(stumps);
  }

  /** 自然岩塊：雜訊塑形後以數個隨機平面切出岩面、平底半埋；頂面依場景長苔、覆雪或沾沙。 */
  function boulderGeometry(detailLevel, rand) {
    const source = new THREE.IcosahedronGeometry(1, detailLevel);
    source.deleteAttribute('normal'); source.deleteAttribute('uv');
    const geometry = mergeVertices(source);
    source.dispose();
    const cuts = Array.from({ length: 7 }, () => ({ normal: randomDirection(rand), offset: 0.58 + rand() * 0.3 }));
    const p = new THREE.Vector3(), positions = geometry.attributes.position, uvs = [];
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i);
      const shape = fbm2(p.x * 1.4 + p.y * 0.9 + 5.3, p.z * 1.4 - p.y * 1.1 + 2.1, 3), grain = noise2(p.x * 4.1 + 1.7, p.z * 4.1 + p.y * 3.3);
      p.multiplyScalar(0.84 + shape * 0.32 + grain * 0.05);
      for (const cut of cuts) { const depth = p.dot(cut.normal) - cut.offset; if (depth > 0) p.addScaledVector(cut.normal, -depth); }
      if (p.y < -0.2) p.y = -0.2 + (p.y + 0.2) * 0.25;
      p.y *= 0.8;
      positions.setXYZ(i, p.x, p.y, p.z);
      uvs.push(p.x * 0.5 + p.z * 0.35 + 0.5, p.y * 0.6 + p.z * 0.2 + 0.5);
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  function rocks(key, rand, mark) {
    const count = key === 'ocean' ? 49 : 72;
    const rockBase = standard('rock', '#ffffff', { envMapIntensity: 1, normalScale: new THREE.Vector2(0.9, 0.9), roughness: key === 'ocean' ? 0.8 : 0.92 });
    const material = gpu ? gpu.patchRock(rockBase, key) : patched(rockBase, 'rock', shader => patchRock(shader, atmo));
    material.color.setRGB(1.55, 1.5, 1.42); // 原始 dark_rock 貼圖偏黑，提亮成自然岩色
    if (!gpu) material.defines = sceneDefine(key);
    const shapes = [0, 1, 2].map(() => {
      const mesh = new THREE.InstancedMesh(boulderGeometry(currentQuality === 'high' ? 3 : 2, rand), material, count);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.count = 0;
      return mesh;
    });
    for (let i = 0; i < count; i++) {
      let z = (rand() - 0.5) * 118;
      let x = key === 'forest' ? creekX(z) + (rand() > 0.5 ? 1 : -1) * (1.9 + rand() * 1.8)
        : key === 'ocean' ? shoreline(z) - 1.5 + rand() * 7 : (rand() - 0.5) * 96;
      if (key === 'ocean' && Math.hypot(x + 2.4, z - 28) < 23) { z -= 36; x = shoreline(z) + rand() * 4; }
      if (key !== 'ocean' && Math.abs(x - pathX(z)) < 2.8) x += x > pathX(z) ? 3 : -3;
      const scale = key === 'ocean' ? 0.42 + rand() * 0.96 : 0.25 + rand() * 0.85;
      const width = scale * (0.9 + rand() * 0.6), mesh = shapes[i % shapes.length];
      instance(mesh, mesh.count++, new THREE.Vector3(x, terrainHeight(key, x, z) + scale * 0.12, z), new THREE.Vector3(width, scale * 0.85, scale), new THREE.Euler(rand() * 0.3, rand() * Math.PI, rand() * 0.25), new THREE.Color().setScalar(0.82 + rand() * 0.3));
      collision.push({ x, z, r: width * 0.8 + 0.35 });
      mark(x, z, width * 1.5 + 0.3, [120, key === 'forest' ? 80 : 0, 0]);
    }
    shapes.forEach(finishInstances);
  }

  /** 地被：步道兩側較茂密、成片分佈的草叢；森林夾雜野花，林下有蕨類。 */
  function undergrowth(key, tier, rand, placements) {
    if (key === 'snow') return;
    const ocean = key === 'ocean';
    const grass = key === 'autumn' ? drawGrass(rand, { hue: [34, 50], saturation: [38, 55], base: 18, tip: 66 })
      : ocean ? drawGrass(rand, { hue: [52, 70], saturation: [22, 34], base: 24, tip: 76, blades: 70 }) : drawGrass(rand);
    const sets = [{ canvas: grass, share: key === 'forest' ? 0.86 : 1 }];
    if (key === 'forest') sets.push({ canvas: drawGrass(rand, { flowers: 18 }), share: 0.16 });
    const total = ocean ? Math.round(tier.grass * 0.45) : key === 'autumn' ? Math.round(tier.grass * 0.75) : tier.grass;
    const card = new THREE.PlaneGeometry(1, 1);
    card.translate(0, 0.5, 0);
    for (const set of sets) {
      const count = Math.round(total * set.share);
      const mesh = new THREE.InstancedMesh(card, foliageMaterial(texture(set.canvas), { weight: 'uv.y * 0.07', upNormal: true, translucency: 0.18 }, { roughness: 0.9 }), count * 2);
      mesh.receiveShadow = true;
      let placed = 0;
      for (let attempt = 0; attempt < count * 8 && placed < count; attempt++) {
        const z = (rand() - 0.5) * 114;
        const x = ocean ? -8 - Math.pow(rand(), 0.8) * 48 : pathX(z) + (rand() - 0.5) * 96;
        if (Math.abs(x) > 60) continue;
        if (ocean) {
          if (x > shoreline(z) - 7 || rand() > 0.3 + smooth(0.4, 0.68, fbm2(x * 0.07, z * 0.07, 3)) * 0.7) continue;
        } else {
          const fromPath = Math.abs(x - pathX(z));
          if (fromPath < 1.75 || (key === 'forest' && Math.abs(x - creekX(z)) < 1.4)) continue;
          const verge = smooth(1.75, 2.6, fromPath) * (1 - smooth(3.2, 6, fromPath));
          if (rand() > 0.3 + verge * 0.5 + smooth(0.42, 0.7, fbm2(x * 0.09 + 4.1, z * 0.09 - 2.7, 3)) * 0.6) continue;
        }
        const tall = ocean ? 0.45 + rand() ** 1.4 * 0.75 : 0.18 + rand() ** 1.6 * 0.62;
        const width = ocean ? 0.6 + rand() * 0.6 : 0.42 + rand() * 0.5, turn = rand() * Math.PI;
        const p = new THREE.Vector3(x, terrainHeight(key, x, z) - 0.03, z), shade = new THREE.Color().setScalar(0.72 + rand() * 0.4);
        for (let plane = 0; plane < 2; plane++) instance(mesh, placed * 2 + plane, p, new THREE.Vector3(width, tall, 1), new THREE.Euler(0, turn + plane * Math.PI / 2, (rand() - 0.5) * 0.18), shade);
        placed++;
      }
      mesh.count = placed * 2;
      finishInstances(mesh);
    }
    if (ocean || !placements.length) return;
    // 蕨類：一株六片羽葉向外拱出，多長在樹腳與溪岸
    const fronds = [];
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.PlaneGeometry(0.42, 1);
      frond.translate(0, 0.5, 0); frond.rotateX(-(0.75 + (i % 2) * 0.25)); frond.rotateY(i / 6 * TAU + (i % 3) * 0.2);
      fronds.push(frond);
    }
    const fernGeometry = mergeGeometries(fronds);
    fronds.forEach(frond => frond.dispose());
    const fernMap = texture(drawFern(rand, key === 'autumn' ? { hue: 30, saturation: 52 } : {}));
    const fernCount = key === 'autumn' ? Math.round(tier.ferns * 0.6) : tier.ferns;
    const ferns = new THREE.InstancedMesh(fernGeometry, foliageMaterial(fernMap, { weight: 'uv.y * 0.05', upNormal: true, translucency: 0.22 }, { roughness: 0.85 }), fernCount);
    ferns.receiveShadow = true;
    let placedFerns = 0;
    for (let attempt = 0; attempt < fernCount * 6 && placedFerns < fernCount; attempt++) {
      let x, z;
      if (key === 'forest' && rand() < 0.3) { z = (rand() - 0.5) * 110; x = creekX(z) + (rand() < 0.5 ? -1 : 1) * (1.7 + rand() * 1.6); }
      else { const tree = placements[Math.floor(rand() * placements.length)], a = rand() * TAU, d = 1.1 + rand() * 4; x = tree.x + Math.cos(a) * d; z = tree.z + Math.sin(a) * d; }
      if (Math.abs(x - pathX(z)) < 2.3 || Math.abs(x) > 60 || Math.abs(z) > 58) continue;
      const scale = 0.55 + rand() * 0.6;
      instance(ferns, placedFerns++, new THREE.Vector3(x, terrainHeight(key, x, z) - 0.02, z), new THREE.Vector3(scale, scale * (0.8 + rand() * 0.4), scale), new THREE.Euler(0, rand() * TAU, 0), new THREE.Color().setScalar(0.75 + rand() * 0.35));
    }
    ferns.count = placedFerns;
    finishInstances(ferns);
  }

  /** 秋林落葉：貼合地形的薄片，集中在樹腳與步道兩側。 */
  function leafLitter(key, tier, rand, placements) {
    const map = texture(drawLitter([...brushSet('golden'), ...brushSet('fiery')], rand));
    const vertices = [], uvs = [], indices = [];
    for (let i = 0; i < tier.litter; i++) {
      let cx, cz;
      if (rand() < 0.55) { const tree = placements[Math.floor(rand() * placements.length)], a = rand() * TAU, d = 0.6 + rand() * 4.5; cx = tree.x + Math.cos(a) * d; cz = tree.z + Math.sin(a) * d; }
      else { cz = (rand() - 0.5) * 112; cx = pathX(cz) + (rand() - 0.5) * 7; }
      const size = 0.9 + rand() * 1.2, turn = rand() * TAU, base = vertices.length / 3;
      for (let gy = 0; gy <= 2; gy++) for (let gx = 0; gx <= 2; gx++) {
        const lx = (gx / 2 - 0.5) * size, lz = (gy / 2 - 0.5) * size;
        const x = cx + lx * Math.cos(turn) - lz * Math.sin(turn), z = cz + lx * Math.sin(turn) + lz * Math.cos(turn);
        vertices.push(x, terrainHeight(key, x, z) + 0.02, z); uvs.push(gx / 2, gy / 2);
      }
      for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 2; gx++) { const a = base + gy * 3 + gx; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = patched(new StandardMaterial({ map, alphaTest: 0.5, alphaToCoverage: !gpu, roughness: 0.92, metalness: 0, envMapIntensity: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'atmosphere', shader => addAtmosphere(shader, atmo));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    world.add(mesh);
  }

  /** 林間溪流：嵌入溪床的較寬水面，水深決定透明度與色澤。 */
  function creek(key) {
    const columns = 9, rows = 150, vertices = [], depths = [], indices = [];
    for (let i = 0; i <= rows; i++) {
      const z = 64 - i * 128 / rows, center = creekX(z), level = terrainHeight(key, center, z) + 0.26;
      for (let j = 0; j < columns; j++) {
        const x = center + (j / (columns - 1) - 0.5) * 4.2;
        vertices.push(x, level, z); depths.push(level - terrainHeight(key, x, z));
      }
      if (i < rows) for (let j = 0; j < columns - 1; j++) { const a = i * columns + j; indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    const colors = { shallow: '#5a5634', deep: '#163a33', bank: '#2b3a24' };
    world.add(new THREE.Mesh(geometry, gpu ? gpu.creekMaterial(sky3d, colors) : creekMaterial(atmo, colors)));
  }

  /** 大西洋：近岸細密、遠方漸疏的網格一路鋪到地平線。 */
  function ocean(tier) {
    const [columns, rows] = tier.ocean, xs = [], zs = [];
    const nearColumns = Math.round(columns * 0.42);
    for (let i = 0; i <= nearColumns; i++) xs.push(2 + i * 62 / nearColumns);
    for (let i = 1; i <= columns - nearColumns; i++) xs.push(64 * Math.pow(3600 / 64, i / (columns - nearColumns)));
    const nearRows = Math.round(rows * 0.6), farRows = Math.round((rows - nearRows) / 2);
    for (let i = farRows; i > 0; i--) zs.push(-80 * Math.pow(3600 / 80, i / farRows));
    for (let i = 0; i <= nearRows; i++) zs.push(-80 + i * 160 / nearRows);
    for (let i = 1; i <= farRows; i++) zs.push(80 * Math.pow(3600 / 80, i / farRows));
    const vertices = [], indices = [];
    for (const z of zs) for (const x of xs) vertices.push(x, 0, z);
    for (let r = 0; r < zs.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) {
      const a = r * xs.length + c, below = a + xs.length;
      indices.push(a, below, a + 1, a + 1, below, below + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const water = LOOKS.ocean.water;
    const mesh = new THREE.Mesh(geometry, gpu ? gpu.oceanMaterial(sky3d, water) : oceanMaterial(atmo, water));
    mesh.position.y = -0.17;
    mesh.frustumCulled = false;
    world.add(mesh);
  }

  function birds(rand) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(GULL, 3));
    const count = 9, flight = [], extra = [];
    for (let i = 0; i < count; i++) {
      const flock = i < 6;
      flight.push(flock ? 70 + rand() * 20 : 140 + rand() * 60, flock ? -40 + rand() * 20 : 20 + rand() * 60, 18 + rand() * 26, (rand() < 0.75 ? 1 : -1) * (7 + rand() * 3));
      extra.push(12 + rand() * 12, rand() * TAU);
    }
    geometry.setAttribute('flight', new THREE.InstancedBufferAttribute(new Float32Array(flight), 4));
    geometry.setAttribute('flightExtra', new THREE.InstancedBufferAttribute(new Float32Array(extra), 2));
    geometry.instanceCount = count;
    const mesh = new THREE.Mesh(geometry, gpu ? gpu.birdMaterial(sky3d, '#3b3f45') : birdMaterial(atmo, '#3b3f45'));
    mesh.frustumCulled = false; mesh.visible = !reducedMotion;
    world.add(mesh); particles.push(mesh);
  }

  /** 光束：沿太陽方向斜落的柔光，集中在步道附近的林隙。 */
  function lightShafts(key, tier, rand) {
    const look = LOOKS[key];
    if (!look.shafts) return;
    const count = key === 'snow' ? Math.round(tier.shafts * 0.4) : tier.shafts;
    const corners = [], bases = [], shafts = [], indices = [];
    for (let i = 0; i < count; i++) {
      const z = 40 - rand() * 98, x = pathX(z) + (rand() - 0.5) * 26, start = corners.length / 2;
      const base = [x, terrainHeight(key, x, z), z], shape = [1.4 + rand() * 2.6, 24 + rand() * 12, rand()];
      for (const [u, v] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { corners.push(u, v); bases.push(...base); shafts.push(...shape); }
      indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bases, 3));
    geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
    geometry.setAttribute('base', new THREE.Float32BufferAttribute(bases, 3));
    geometry.setAttribute('shaft', new THREE.Float32BufferAttribute(shafts, 3));
    geometry.setIndex(indices);
    const shaftColor = displayColor(look.shafts[0], look.shafts[1]);
    const mesh = new THREE.Mesh(geometry, gpu ? gpu.shaftMaterial(sky3d, shaftColor) : shaftMaterial(atmo, shaftColor));
    mesh.frustumCulled = false; mesh.renderOrder = 2;
    world.add(mesh);
  }

  function particleField(count, rand, material, extra) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    if (extra) geometry.setAttribute(extra.name, extra.attribute);
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; points.visible = !reducedMotion;
    world.add(points); particles.push(points);
  }

  /** 天候粒子：雪林飄雪、秋林落葉、森林與秋林的光中浮塵；全由 GPU 依時間計算，跟隨相機。 */
  function weather(key, tier, rand) {
    const addSprite = sprite => { sprite.visible = !reducedMotion; world.add(sprite); particles.push(sprite); };
    const snow = { color: '#f3f8fb', box: [46, 22, 46], size: 0.045 };
    if (key === 'snow') {
      if (gpu) addSprite(gpu.snowSprites(sky3d, { count: tier.snowflakes, rand, ...snow }));
      else particleField(tier.snowflakes, rand, snowMaterial(atmo, snow));
    }
    if (key === 'autumn') {
      const colors = new Float32Array(tier.fallingLeaves * 3), choices = ['#e8a028', '#d9661c', '#b8321c', '#f2c240', '#9c5a22'].map(value => new THREE.Color(value));
      for (let i = 0; i < tier.fallingLeaves; i++) choices[Math.floor(rand() * choices.length)].toArray(colors, i * 3);
      if (gpu) addSprite(gpu.leafSprites(sky3d, { count: tier.fallingLeaves, rand, colors, box: [40, 18, 40], size: 0.16 }));
      else particleField(tier.fallingLeaves, rand, fallingLeafMaterial(atmo, { box: [40, 18, 40], size: 0.16 }), { name: 'leafColor', attribute: new THREE.BufferAttribute(colors, 3) });
    }
    if (gpu && (key === 'forest' || key === 'autumn')) {
      addSprite(gpu.moteSprites(sky3d, { count: key === 'autumn' ? Math.round(tier.motes * 0.6) : tier.motes, rand, color: displayColor(LOOKS[key].motes, 0.9), box: [34, 9, 34], size: 0.025 }));
      return;
    }
    if (key === 'forest' || key === 'autumn') {
      const look = LOOKS[key];
      particleField(key === 'autumn' ? Math.round(tier.motes * 0.6) : tier.motes, rand, moteMaterial(atmo, { color: displayColor(look.motes, 0.9), box: [34, 9, 34], size: 0.025 }));
    }
  }

  function updateShadow() {
    sunlight.target.position.set(camera.position.x, 0, camera.position.z - 8);
    sunlight.position.copy(sunlight.target.position).addScaledVector(atmo.sunDirection.value, 70);
    sunlight.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
    if (gpu) sunlight.shadow.needsUpdate = true;
  }

  function recenter() {
    const z = currentScene === 'ocean' ? 28 : 34;
    const x = currentScene === 'ocean' ? -2.4 : pathX(z);
    camera.position.set(x, terrainHeight(currentScene, x, z) + EYE_HEIGHT, z);
    yaw = currentScene === 'ocean' ? -1.16 : -0.08;
    pitch = currentScene === 'ocean' ? -0.09 : 0.015;
    camera.rotation.set(pitch, yaw, 0);
    distance = 0;
    Object.keys(input).forEach(key => { input[key] = false; });
    updateShadow();
    if (world && !running) draw();
  }

  function buildScene(key, preservePosition = false) {
    if (world) {
      scene.remove(world); disposeGroup(world, modelGeometries, modelMaterials);
      transientTextures.forEach(texture => texture.dispose());
      transientTextures = [];
      renderer.renderLists?.dispose();
    }
    world = new THREE.Group(); scene.add(world);
    collision = []; particles = [];
    currentScene = key;
    const tier = TIERS[currentQuality];
    const rand = randomSeed(key === 'forest' ? 481 : key === 'ocean' ? 925 : key === 'autumn' ? 391 : 808);
    applyLook(key, tier);
    sky();
    const detail = groundDetail();
    terrain(key, tier, detail.texture);
    const placements = key === 'ocean' ? [] : placeTrees(key, tier, rand);
    if (placements.length) forestTrees(key, tier, rand, placements, detail.mark);
    farForest(key, tier, rand);
    rocks(key, rand, detail.mark);
    if (key !== 'snow') scannedDetails(key, rand, detail.mark);
    undergrowth(key, tier, rand, placements);
    if (key === 'autumn') leafLitter(key, tier, rand, placements);
    if (key === 'forest') creek(key);
    if (key === 'ocean') { ocean(tier); birds(rand); }
    lightShafts(key, tier, rand);
    weather(key, tier, rand);
    detail.finish();
    brushCache.clear(); // 葉片筆刷只在產生貼圖時使用，釋放約十 MB 的畫布記憶體
    if (preservePosition) {
      camera.position.y = terrainHeight(key, camera.position.x, camera.position.z) + EYE_HEIGHT;
      updateShadow();
    } else recenter();
    resize(); draw();
  }

  function allowed(x, z) {
    if (x < -55 || x > 55 || z < -55 || z > 55) return false;
    if (currentScene === 'ocean' && x > shoreline(z) - 2.5) return false;
    return !collision.some(object => (x - object.x) ** 2 + (z - object.z) ** 2 < object.r ** 2);
  }

  function move(dt) {
    const f = Number(input.forward) - Number(input.backward);
    const s = Number(input.right) - Number(input.left);
    const length = Math.hypot(f, s);
    if (!length) return;
    const speed = 2.05 * dt / length;
    const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
    const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
    const oldX = camera.position.x, oldZ = camera.position.z;
    if (allowed(oldX + dx, oldZ + dz)) { camera.position.x += dx; camera.position.z += dz; }
    else {
      if (allowed(oldX + dx, oldZ)) camera.position.x += dx;
      if (allowed(camera.position.x, oldZ + dz)) camera.position.z += dz;
    }
    distance += Math.hypot(camera.position.x - oldX, camera.position.z - oldZ);
    camera.position.y = terrainHeight(currentScene, camera.position.x, camera.position.z) + EYE_HEIGHT;
    if (Math.hypot(camera.position.x - sunlight.target.position.x, camera.position.z - sunlight.target.position.z - 8) > 5) updateShadow();
  }

  function draw() {
    if (disposed || failed) return;
    try {
      if (pipeline) { renderer.info.reset(); pipeline.render(); } else renderer.render(scene, camera);
    } catch (error) { fail(`3D 畫面無法繼續顯示：${error.message}`); }
  }

  function tick(time) {
    frame = null;
    if (disposed || failed || !running) return;
    const dt = lastTime ? Math.min(Math.max((time - lastTime) / 1000, 0), 0.05) : 0;
    lastTime = time; if (!reducedMotion) clockTime += dt;
    move(dt);
    atmo.time.value = clockTime;
    sky3d?.frame(clockTime);
    draw();
    statsFrames++;
    if (!statsTime) { statsTime = time; statsFrames = 0; }
    if (time - statsTime >= 1000) {
      onStats({ fps: statsFrames * 1000 / (time - statsTime), position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, distance, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, scene: currentScene, quality: currentQuality });
      statsTime = time; statsFrames = 0;
    }
    if (!failed) frame = requestAnimationFrame(tick);
  }

  buildScene(initialScene);
  frame = requestAnimationFrame(tick);
  return {
    setScene(key) {
      if (disposed) return;
      if (!SCENES.has(key)) throw new RangeError('不支援這個自然場景。');
      if (gpu && !GPU_SCENES.has(key)) throw new RangeError('WebGPU 試點尚未支援這個自然場景。');
      buildScene(key); lastTime = 0; statsTime = 0; statsFrames = 0;
    },
    setRunning(value) {
      if (disposed || failed) return;
      running = Boolean(value); lastTime = 0;
      if (running && frame === null) frame = requestAnimationFrame(tick);
      if (!running && frame !== null) { cancelAnimationFrame(frame); frame = null; }
      if (!running) { Object.keys(input).forEach(key => { input[key] = false; }); draw(); }
    },
    setInput(values) {
      if (disposed) return;
      for (const key of Object.keys(input)) if (Object.hasOwn(values, key)) input[key] = values[key] === true;
    },
    look(dx, dy) {
      if (disposed || failed || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      yaw -= THREE.MathUtils.clamp(dx, -350, 350) * 0.0022;
      pitch = THREE.MathUtils.clamp(pitch - THREE.MathUtils.clamp(dy, -350, 350) * 0.0022, -1.15, 1.18);
      camera.rotation.set(pitch, yaw, 0);
      if (!running) draw();
    },
    recenter,
    setQuality(tier) {
      if (disposed) return;
      if (!TIERS[tier]) throw new RangeError('不支援這個畫質。');
      if (tier === currentQuality) return;
      currentQuality = tier; buildScene(currentScene, true); lastTime = 0;
    },
    getState() {
      return { scene: currentScene, quality: currentQuality, backend, running, ready: !disposed && !failed, reducedMotion, position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, rotation: { yaw, pitch }, distance, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      if (disposed) return;
      disposed = true; running = false;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect(); canvas.removeEventListener('webglcontextlost', onContextLost); motionPreference.removeEventListener('change', onMotionPreference);
      if (world) disposeGroup(world, modelGeometries, modelMaterials);
      transientTextures.forEach(texture => texture.dispose());
      textures.forEach(texture => texture.dispose());
      if (envTarget) envTarget.dispose();
      modelGeometries.forEach(geometry => geometry.dispose()); modelMaterials.forEach(material => material.dispose()); modelTextures.forEach(texture => texture.dispose());
      sunlight.shadow.dispose(); sky3d?.dispose(); pipeline?.dispose(); pmrem.dispose(); renderer.renderLists?.dispose(); renderer.dispose();
    },
  };
}

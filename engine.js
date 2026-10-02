import * as THREE from './vendor/three.module.js';
import { HDRLoader } from './vendor/HDRLoader.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';

const SCENES = new Set(['forest', 'ocean', 'autumn', 'snow']);
const TIERS = {
  high: { trees: 156, foliage: 14, leaflets: 52, grass: 3700, particles: 360, shadow: 2048, ratio: 1.5, segments: 160 },
  balanced: { trees: 98, foliage: 10, leaflets: 28, grass: 1600, particles: 150, shadow: 1024, ratio: 1, segments: 104 },
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const EYE_HEIGHT = 1.65;

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

function foliageTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const rand = randomSeed(kind === 'grass' ? 17 : kind === 'pine' ? 38 : 61);
  if (kind === 'grass') {
    for (let i = 0; i < 26; i++) {
      const base = rand() * 256;
      const tip = base + (rand() - 0.5) * 70;
      const top = 30 + rand() * 215;
      context.fillStyle = `hsl(${76 + rand() * 28} 19% ${19 + rand() * 17}%)`;
      context.beginPath();
      context.moveTo(base - 0.8, 256);
      context.quadraticCurveTo(base - 7, top + 55, tip, top);
      context.quadraticCurveTo(base + 9, top + 70, base + 0.9, 256);
      context.fill();
    }
  } else {
    const count = kind === 'pine' ? 250 : 98;
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = Math.sqrt(rand()) * 111;
      const x = 128 + Math.cos(angle) * radius;
      const y = 128 + Math.sin(angle) * radius * 0.87;
      context.save();
      context.translate(x, y);
      context.rotate(rand() * Math.PI);
      context.fillStyle = `hsl(${kind === 'pine' ? 106 : 89} ${18 + rand() * 23}% ${26 + rand() * 35}%)`;
      context.beginPath();
      context.ellipse(0, 0, kind === 'pine' ? 1.6 : 4 + rand() * 4, kind === 'pine' ? 9 : 8 + rand() * 5, 0, 0, Math.PI * 2);
      context.fill();
      if (kind !== 'pine') {
        context.strokeStyle = 'rgba(237,244,177,.23)';
        context.lineWidth = 0.6;
        context.beginPath(); context.moveTo(0, -8); context.lineTo(0, 8); context.stroke();
      }
      context.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function skyMaterial(key) {
  const ocean = key === 'ocean';
  const snow = key === 'snow';
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(snow ? '#91aec5' : ocean ? '#477d9f' : '#6b99b1') },
      horizonColor: { value: new THREE.Color(snow ? '#e0e7e8' : ocean ? '#ebd9b5' : '#e8ebd6') },
      sunDirection: { value: new THREE.Vector3(ocean ? -0.36 : -0.43, ocean ? 0.16 : 0.67, -0.45).normalize() },
      cloudiness: { value: snow ? 0.7 : 0.36 },
    },
    vertexShader: `varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDirection; uniform float cloudiness;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
      float fbm(vec2 p){float v=0.;float a=.52;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.07+1.7;a*=.5;}return v;}
      void main(){
        vec3 d=normalize(vDirection);float h=max(d.y,0.0);
        vec3 color=mix(horizonColor,topColor,pow(h,.43));
        float sun=max(dot(d,sunDirection),0.0);
        color+=vec3(1.,.78,.43)*pow(sun,30.)*.19+vec3(1.,.91,.72)*pow(sun,900.)*3.0;
        vec2 cloudUv=d.xz/max(d.y+.22,.12)*1.7;
        float cloud=smoothstep(.57-cloudiness*.12,.8,fbm(cloudUv+vec2(13.,4.)))*smoothstep(0.0,.16,d.y);
        color=mix(color,vec3(.93,.94,.9),cloud*.76);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function waterMaterial(key, fog) {
  const ocean = key === 'ocean';
  return new THREE.ShaderMaterial({
    transparent: false, side: THREE.DoubleSide, fog: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      time: { value: 0 }, ocean: { value: ocean ? 1 : 0 },
      deepColor: { value: new THREE.Color(ocean ? '#244e56' : '#28433b') },
      skyColor: { value: new THREE.Color(ocean ? '#b6ced0' : '#8a9d7f') },
      fogColor: { value: fog.color }, fogNear: { value: fog.near }, fogFar: { value: fog.far },
    },
    vertexShader: `
      uniform float time;uniform float ocean;varying vec3 vWorld;varying float vWave;
      #include <fog_pars_vertex>
      void main(){
        vec3 p=position;float a=sin(p.x*.53+p.z*.31-time*.82);float b=sin(p.x*1.21-p.z*.83-time*1.3);
        p.y+=(a*.13+b*.046)*mix(.12,1.,ocean);
        vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;vWave=a;
        vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time;uniform float ocean;uniform vec3 deepColor;uniform vec3 skyColor;
      varying vec3 vWorld;varying float vWave;
      #include <fog_pars_fragment>
      void main(){
        vec3 n=normalize(vec3(-.065*cos(vWorld.x*.53+vWorld.z*.31-time*.82)-.026*cos(vWorld.x*1.21-vWorld.z*.83-time*1.3),1.,-.04*cos(vWorld.x*.53+vWorld.z*.31-time*.82)));
        vec3 view=normalize(cameraPosition-vWorld);float fresnel=pow(1.-max(dot(view,n),0.),3.);
        float ripple=sin(vWorld.x*9.1+sin(vWorld.z*6.3)+time*.56)*sin(vWorld.z*8.8-time*.7)*.027;
        vec3 color=mix(deepColor,skyColor,fresnel*.83)+ripple;
        float spec=pow(max(dot(reflect(-normalize(vec3(-.4,.36,-.5)),n),view),0.),130.);
        color+=vec3(1.,.85,.58)*spec*.68;
        float edge=5.2+sin(vWorld.z*.095)*1.3;
        float surf=exp(-abs(vWorld.x-edge-1.2)*.6);
        float foam=smoothstep(.55,.88,sin(vWorld.x*4.8+vWorld.z*.61-time*1.45)+sin(vWorld.z*8.9)*.2)*surf*ocean;
        color=mix(color,vec3(.84,.89,.84),foam*.72);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** 真實地形上的第一人稱探索；介面僅處理移動與渲染，降級選擇由使用者介面負責。 */
export async function createExplorer({ canvas, scene: initialScene = 'forest', quality = 'high', onStats = () => {}, onFailure = () => {} }) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('探索畫布不存在。');
  if (!SCENES.has(initialScene)) throw new RangeError('不支援這個自然場景。');
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
  let animationMaterials = [];
  let particles = null;
  let transientTextures = [];
  const textures = new Map();
  const modelGeometries = new Set(), modelMaterials = new Set(), modelTextures = new Set();
  const models = new Map();
  let hdrTexture = null;
  let hdrTarget = null;
  const input = { forward: false, backward: false, left: false, right: false };
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  function onMotionPreference(event) {
    reducedMotion = event.matches;
    if (particles) particles.mesh.visible = !reducedMotion;
    if (!running) draw();
  }
  motionPreference.addEventListener('change', onMotionPreference);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 260);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();

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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    onFailure(`這個裝置無法啟動 3D：${error.message}`);
    throw error;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.debug.onShaderError = (gl, program) => fail(`3D 材質編譯失敗：${gl.getProgramInfoLog(program) || '裝置未提供詳細訊息'}`);
  const onContextLost = event => { event.preventDefault(); fail('圖形裝置中斷，請改用輕量版或重新載入。'); };
  canvas.addEventListener('webglcontextlost', onContextLost);

  const sunlight = new THREE.DirectionalLight('#fff0d6', 3.15);
  sunlight.castShadow = true;
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -30;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 30;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 85;
  sunlight.shadow.bias = -0.00035;
  sunlight.shadow.normalBias = 0.04;
  const hemisphere = new THREE.HemisphereLight('#e3eff8', '#414431', 1.0);
  scene.add(sunlight, sunlight.target, hemisphere);
  const pmrem = new THREE.PMREMGenerator(renderer);

  function resize() {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[currentQuality].ratio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      if (name.startsWith('ground')) texture.repeat.set(26, 26);
      if (name.startsWith('bark')) texture.repeat.set(1.2, 4.2);
      if (name.startsWith('rock')) texture.repeat.set(1.25, 1.25);
      if (name.startsWith('sand')) texture.repeat.set(22, 22);
      textures.set(name, texture);
    }));
    await Promise.all(['twig', 'twig-alpha', 'twig-normal', 'leaf', 'leaf-alpha', 'leaf-normal'].map(async name => {
      const extension = name === 'leaf-alpha' ? 'png' : 'jpg';
      const texture = await loader.loadAsync(`./assets/pbr/${name}.${extension}`);
      texture.colorSpace = name === 'twig' || name === 'leaf' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      const crop = name.startsWith('twig') ? { x: 30, y: 40, width: 198, height: 415 } : { x: 706, y: 171, width: 149, height: 139 };
      texture.offset.set(crop.x / 1024, 1 - (crop.y + crop.height) / 1024);
      texture.repeat.set(crop.width / 1024, crop.height / 1024);
      textures.set(name, texture);
    }));
    hdrTexture = await new HDRLoader().loadAsync('./assets/pbr/sky.hdr');
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    hdrTarget = pmrem.fromEquirectangular(hdrTexture);
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
          for (const value of Object.values(material)) if (value?.isTexture) {
            value.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); modelTextures.add(value);
          }
        }
        meshes.push(object);
      });
      if (!meshes.length) throw new Error(`掃描模型 ${name} 沒有可繪製的網格。`);
      models.set(name, meshes);
    }));
  } catch (error) {
    textures.forEach(texture => texture.dispose());
    if (hdrTexture) hdrTexture.dispose();
    if (hdrTarget) hdrTarget.dispose();
    modelGeometries.forEach(geometry => geometry.dispose()); modelMaterials.forEach(material => material.dispose()); modelTextures.forEach(texture => texture.dispose());
    resizeObserver.disconnect();
    motionPreference.removeEventListener('change', onMotionPreference);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    pmrem.dispose(); renderer.dispose();
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
  function standard(map, color = '#ffffff', extra = {}) {
    return new THREE.MeshStandardMaterial({
      color, map: map ? textures.get(map) : null, normalMap: map ? textures.get(`${map}-normal`) : null,
      normalScale: new THREE.Vector2(0.65, 0.65), roughness: 0.95, metalness: 0, envMapIntensity: 0.72, ...extra,
    });
  }

  function croppedFoliage(name) {
    const crop = name === 'twig' ? { x: 30, y: 40, width: 198, height: 415 } : { x: 706, y: 171, width: 149, height: 139 };
    const canvas = document.createElement('canvas');
    canvas.width = crop.width; canvas.height = crop.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(textures.get(name).image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const diffuse = context.getImageData(0, 0, crop.width, crop.height);
    context.clearRect(0, 0, crop.width, crop.height);
    context.drawImage(textures.get(`${name}-alpha`).image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const mask = context.getImageData(0, 0, crop.width, crop.height).data;
    const count = crop.width * crop.height, removed = new Uint8Array(count), queue = [];
    // 模型 atlas 的 UV 延展區可能同為白遮罩；刪除貼著裁切邊界的連通塊，保留獨立葉片。
    function removeAt(index) {
      if (removed[index] || mask[index * 4] < 100) return;
      removed[index] = 1; queue.push(index);
    }
    if (name === 'twig') {
      for (let x = 0; x < crop.width; x++) { removeAt(x); removeAt((crop.height - 1) * crop.width + x); }
      for (let y = 0; y < crop.height; y++) { removeAt(y * crop.width); removeAt(y * crop.width + crop.width - 1); }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % crop.width, y = Math.floor(index / crop.width);
      if (x > 0) removeAt(index - 1); if (x < crop.width - 1) removeAt(index + 1);
      if (y > 0) removeAt(index - crop.width); if (y < crop.height - 1) removeAt(index + crop.width);
    }
    for (let i = 0; i < count; i++) diffuse.data[i * 4 + 3] = removed[i] ? 0 : mask[i * 4];
    context.putImageData(diffuse, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    transientTextures.push(texture);
    return texture;
  }

  function ground(key, tier) {
    const geometry = new THREE.PlaneGeometry(134, 136, tier.segments, tier.segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const colors = [];
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      positions.setY(i, terrainHeight(key, x, z));
      const noise = 0.94 + Math.sin(x * 0.29) * Math.cos(z * 0.36) * 0.035;
      color.set(key === 'snow' ? '#f1f4f4' : key === 'autumn' ? '#9d8050' : key === 'ocean' ? '#e7d6ba' : '#a3ac88').multiplyScalar(noise);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = key === 'snow'
      ? standard(null, '#ffffff', { normalMap: textures.get('ground-normal'), normalScale: new THREE.Vector2(0.25, 0.25), vertexColors: true, roughness: 0.88 })
      : standard(key === 'ocean' ? 'sand' : 'ground', '#ffffff', { vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    world.add(mesh);
    if (key === 'ocean') return;
    const vertices = [], uvs = [], indices = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const z = 59 - i * 118 / steps;
      const center = pathX(z), width = 1.64 + Math.sin(z * 0.17) * 0.17;
      for (const x of [center - width, center + width]) vertices.push(x, terrainHeight(key, x, z) + 0.022, z);
      uvs.push(0, i / steps * 0.8, 0.14, i / steps * 0.8);
      if (i < steps) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const path = new THREE.BufferGeometry();
    path.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    path.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    path.setIndex(indices); path.computeVertexNormals();
    const pathMaterial = key === 'snow'
      ? standard(null, '#cbd4d5', { normalMap: textures.get('ground-normal'), normalScale: new THREE.Vector2(0.15, 0.15) })
      : standard('sand', key === 'autumn' ? '#a98c62' : '#938d73', { normalScale: new THREE.Vector2(0.34, 0.34) });
    const pathMesh = new THREE.Mesh(path, pathMaterial);
    pathMesh.receiveShadow = true;
    world.add(pathMesh);
  }

  function trees(key, tier, rand) {
    const pine = key === 'snow';
    const placements = [];
    for (let i = 0; i < tier.trees; i++) {
      let x, z;
      do {
        z = (rand() - 0.5) * 118;
        x = pathX(z) + (rand() - 0.5) * (rand() < 0.8 ? 38 : 88);
      }
      while (Math.abs(x - pathX(z)) < 3.35 || (key === 'forest' && Math.abs(x - creekX(z)) < 1.8));
      const young = !pine && rand() < 0.2;
      placements.push({ x, z, y: terrainHeight(key, x, z), height: young ? 4.4 + rand() * 3.8 : (pine ? 8.1 : 8.7) + rand() * 9.3, radius: young ? 0.09 + rand() * 0.11 : 0.17 + rand() ** 1.8 * 0.48, angle: rand() * Math.PI * 2 });
    }
    // 固定前景樹把視線引導到彎曲小徑，遠近層次由真實相機視差形成。
    placements[0] = { x: pathX(27) - 3.5, z: 27, y: terrainHeight(key, pathX(27) - 3.5, 27), height: 13, radius: 0.48, angle: 0.3 };
    placements[1] = { x: pathX(20) + 4.5, z: 20, y: terrainHeight(key, pathX(20) + 4.5, 20), height: 16, radius: 0.55, angle: 1.5 };
    const bark = standard('bark', pine ? '#928c7f' : '#beb3a0');
    const trunkGeometry = new THREE.CylinderGeometry(0.46, 1, 1, 14, 12);
    const trunkPositions = trunkGeometry.attributes.position;
    for (let i = 0; i < trunkPositions.count; i++) {
      const y = trunkPositions.getY(i) + 0.5;
      trunkPositions.setX(i, trunkPositions.getX(i) + Math.sin(y * 3.8) * y * 0.12);
      trunkPositions.setZ(i, trunkPositions.getZ(i) + Math.sin(y * 4.9 + 0.8) * y * 0.13);
    }
    trunkGeometry.computeVertexNormals();
    const trunks = new THREE.InstancedMesh(trunkGeometry, bark, placements.length);
    trunks.castShadow = trunks.receiveShadow = true;
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 1, 1, 8), bark, placements.length * (pine ? 41 : 15));
    branches.castShadow = branches.receiveShadow = true;
    const leafTexture = croppedFoliage(pine ? 'twig' : 'leaf');
    const leaves = new THREE.MeshStandardMaterial({ map: leafTexture, normalMap: textures.get(pine ? 'twig-normal' : 'leaf-normal'), normalScale: new THREE.Vector2(0.32, 0.32), alphaTest: 0.46, side: THREE.DoubleSide, roughness: 0.94, envMapIntensity: 0.76, color: '#ffffff' });
    if (pine) {
      leaves.onBeforeCompile = shader => {
        shader.vertexShader = 'varying float vSnow;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnow=clamp((mat3(modelMatrix)*mat3(instanceMatrix)*normal).y,0.0,1.0);');
        shader.fragmentShader = 'varying float vSnow;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat snowNoise=fract(sin(dot(vMapUv,vec2(48.3,71.4)))*164.31);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.89,.91),vSnow*smoothstep(.18,.68,snowNoise)*.88);');
      };
    } else if (key === 'autumn') {
      leaves.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat leafLight=dot(diffuseColor.rgb,vec3(.21,.68,.11));vec3 autumnHue=mix(vec3(1.0,.49,.055),vec3(.85,.23,.028),clamp(diffuseColor.r*3.0,0.0,1.0));diffuseColor.rgb=autumnHue*max(.065,leafLight*2.1);');
      };
    }
    const leafCount = placements.length * (pine ? 576 : tier.foliage * tier.leaflets);
    const crowns = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leaves, leafCount);
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    let snowCaps = null;
    if (pine) {
      const canvas = document.createElement('canvas');
      canvas.width = leafTexture.image.width; canvas.height = leafTexture.image.height;
      const context = canvas.getContext('2d'); context.drawImage(leafTexture.image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.data.length; i += 4) data.data[i] = data.data[i + 1] = data.data[i + 2] = 248;
      context.putImageData(data, 0, 0);
      const snowTexture = new THREE.CanvasTexture(canvas); snowTexture.colorSpace = THREE.SRGBColorSpace; transientTextures.push(snowTexture);
      snowCaps = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: snowTexture, alphaTest: 0.46, color: '#f0f6f5', roughness: 0.89, side: THREE.DoubleSide, envMapIntensity: 0.63 }), placements.length * 288);
      snowCaps.receiveShadow = true;
      snowCaps.castShadow = true;
    }
    const color = new THREE.Color();
    let branchIndex = 0, leafIndex = 0, snowIndex = 0;
    for (let i = 0; i < placements.length; i++) {
      const tree = placements[i], { x, y, z, height: h, radius: r, angle } = tree;
      collision.push({ x, z, r: r + 0.38 });
      instance(trunks, i, new THREE.Vector3(x, y + h * 0.5, z), new THREE.Vector3(r, h, r), new THREE.Euler((rand() - 0.5) * 0.024, angle, (rand() - 0.5) * 0.03));
      if (pine) {
        for (let level = 0; level < 6; level++) {
          const t = level / 6, reach = (2.7 + rand() * 0.8) * (1 - t) + 0.2;
          const sy = y + h * (0.24 + t * 0.71 + (rand() - 0.5) * 0.07);
          const arms = 4 + Math.floor(rand() * 3);
          for (let arm = 0; arm < arms; arm++) {
            const a = angle + arm * Math.PI * 2 / arms + level * 0.51 + (rand() - 0.5) * 0.35;
            const end = new THREE.Vector3(x + Math.cos(a) * reach, sy - 0.4 + t * 0.4, z + Math.sin(a) * reach);
            cylinderInstance(branches, branchIndex++, new THREE.Vector3(x, sy, z), end, r * (0.42 - t * 0.25));
            for (let segment = 0; segment < 16; segment++) {
              const fraction = 0.21 + (segment % 8) * 0.1;
              const p = new THREE.Vector3(x, sy, z).lerp(end, fraction).add(new THREE.Vector3((rand() - 0.5) * 0.55, (rand() - 0.5) * 0.45, (rand() - 0.5) * 0.55));
              const length = 0.96 + (1 - t) * 0.48;
              color.set('#c1d2c7').multiplyScalar(0.9 + rand() * 0.25);
              const twigAngle = a + (rand() - 0.5) * 1.5;
              const branchDirection = new THREE.Vector3(Math.cos(twigAngle), (rand() - 0.5) * 0.5, Math.sin(twigAngle)).normalize();
              const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, branchDirection);
              rotation.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, (rand() - 0.5) * 0.9));
              instance(crowns, leafIndex++, p, new THREE.Vector3(length * 0.48, length, 1), rotation, color);
              if (segment % 2 === 0) {
                const snowRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (rand() - 0.5) * 0.23, -twigAngle - Math.PI / 2, 0, 'YXZ'));
                instance(snowCaps, snowIndex++, p.clone().add(new THREE.Vector3(0, 0.055, 0)), new THREE.Vector3(length * 0.51, length * 1.06, 1), snowRotation);
              }
            }
          }
        }
        for (let arm = 0; arm < 5; arm++) {
          const a = angle + arm * Math.PI * 0.4;
          cylinderInstance(branches, branchIndex++, new THREE.Vector3(x, y + 0.08, z), new THREE.Vector3(x + Math.cos(a) * r * 2.1, y - 0.09, z + Math.sin(a) * r * 2.1), r * 0.42);
        }
      } else {
        const clusterCenters = [];
        const mainBranches = 5 + Math.floor(rand() * 6);
        for (let b = 0; b < mainBranches; b++) {
          const a = angle + b * Math.PI * 0.77 + (rand() - 0.5) * 0.8;
          const reach = 2.5 + rand() * 2.0;
          const sy = y + h * (0.35 + rand() * 0.35);
          const end = new THREE.Vector3(x + Math.cos(a) * reach, y + h * (0.64 + rand() * 0.33), z + Math.sin(a) * reach);
          cylinderInstance(branches, branchIndex++, new THREE.Vector3(x, sy, z), end, r * (0.28 + rand() * 0.21));
          clusterCenters.push(end);
        }
        for (let b = 0; b < 5; b++) {
          const a = angle + b * Math.PI * 0.4;
          cylinderInstance(branches, branchIndex++, new THREE.Vector3(x, y + 0.1, z), new THREE.Vector3(x + Math.cos(a) * r * 2.4, y - 0.1, z + Math.sin(a) * r * 2.4), r * 0.47);
        }
        for (let cluster = 0; cluster < tier.foliage; cluster++) {
          const center = cluster < mainBranches ? clusterCenters[cluster] : new THREE.Vector3(x + (rand() - 0.5) * 4, y + h * (0.73 + rand() * 0.24), z + (rand() - 0.5) * 4);
          const spread = 1.25 + rand() * 0.55;
          for (let leaf = 0; leaf < tier.leaflets; leaf++) {
            const a = rand() * Math.PI * 2, v = rand() * 2 - 1, radius = Math.cbrt(rand()) * spread;
            const leafPosition = center.clone().add(new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - v * v) * radius, v * radius * 0.74, Math.sin(a) * Math.sqrt(1 - v * v) * radius));
            const size = 0.29 + rand() * 0.22;
            color.setHSL(key === 'autumn' ? 0.095 + rand() * 0.05 : 0.19 + rand() * 0.07, key === 'autumn' ? 0.62 : 0.19, key === 'autumn' ? 0.72 : 0.79 + rand() * 0.14);
            instance(crowns, leafIndex++, leafPosition, new THREE.Vector3(size, size * 0.92, 1), new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI), color);
          }
        }
      }
    }
    branches.count = branchIndex;
    crowns.count = leafIndex;
    finishInstances(trunks); finishInstances(branches); finishInstances(crowns);
    if (snowCaps) { snowCaps.count = snowIndex; finishInstances(snowCaps); }
  }

  function scannedDetails(key, rand) {
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
    }
    finishInstances(stumps);
  }

  function rocks(key, rand) {
    const count = key === 'ocean' ? 49 : 72;
    const geometry = new THREE.IcosahedronGeometry(1, currentQuality === 'high' ? 3 : 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i);
      const factor = 0.9 + Math.sin(p.x * 4.8 + p.y * 7.1 + p.z * 3.3) * 0.11;
      p.multiplyScalar(factor); positions.setXYZ(i, p.x, p.y, p.z);
    }
    const normals = geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i).normalize();
      normals.setXYZ(i, p.x, p.y, p.z);
    }
    const stones = new THREE.InstancedMesh(geometry, standard('rock', key === 'snow' ? '#f4f5f2' : '#f1eadb', { envMapIntensity: 1.05, normalScale: new THREE.Vector2(0.48, 0.48) }), count);
    stones.castShadow = stones.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      let z = (rand() - 0.5) * 118;
      let x = key === 'forest' ? creekX(z) + (rand() > 0.5 ? 1 : -1) * (1.9 + rand() * 1.8)
        : key === 'ocean' ? shoreline(z) - 1.5 + rand() * 7 : (rand() - 0.5) * 96;
      if (key === 'ocean' && Math.hypot(x + 2.4, z - 28) < 23) { z -= 36; x = shoreline(z) + rand() * 4; }
      if (key !== 'ocean' && Math.abs(x - pathX(z)) < 2.8) x += x > pathX(z) ? 3 : -3;
      const scale = key === 'ocean' ? 0.42 + rand() * 0.96 : 0.25 + rand() * 0.85;
      const width = scale * (0.9 + rand() * 0.6);
      instance(stones, i, new THREE.Vector3(x, terrainHeight(key, x, z) + scale * 0.2, z), new THREE.Vector3(width, scale * 0.67, scale), new THREE.Euler(rand() * 0.6, rand() * Math.PI, rand() * 0.35), new THREE.Color().setScalar(0.86 + rand() * 0.24));
      collision.push({ x, z, r: width * 0.8 + 0.35 });
    }
    finishInstances(stones);
  }

  function undergrowth(key, tier, rand) {
    if (key === 'snow') return;
    const texture = foliageTexture('grass');
    transientTextures.push(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: key === 'autumn' ? '#c9bd97' : key === 'ocean' ? '#c6c091' : '#bdc5a0', envMapIntensity: 0.75 });
    const count = key === 'ocean' ? Math.floor(tier.grass * 0.2) : tier.grass;
    const grass = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count * 2);
    grass.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      let x, z;
      do {
        z = (rand() - 0.5) * 112;
        x = key === 'ocean' ? -10 - rand() * 25 : (rand() - 0.5) * 92;
      } while (key !== 'ocean' && (Math.abs(x - pathX(z)) < 1.8 || (key === 'forest' && Math.abs(x - creekX(z)) < 1.45)));
      const height = 0.11 + rand() ** 1.8 * 0.6, width = 0.34 + rand() * 0.48, angle = rand() * Math.PI;
      const p = new THREE.Vector3(x, terrainHeight(key, x, z) + height * 0.5, z);
      for (let plane = 0; plane < 2; plane++) instance(grass, i * 2 + plane, p, new THREE.Vector3(width, height, 1), new THREE.Euler(0, angle + plane * Math.PI / 2, (rand() - 0.5) * 0.14), new THREE.Color().setScalar(0.64 + rand() * 0.38));
    }
    finishInstances(grass);
  }

  function water(key, tier) {
    const material = waterMaterial(key, scene.fog);
    animationMaterials.push(material);
    let geometry;
    if (key === 'ocean') {
      geometry = new THREE.PlaneGeometry(240, 240, tier.segments, Math.floor(tier.segments * 0.75));
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(118, -0.17, 0);
      world.add(mesh);
    } else {
      const vertices = [], indices = [];
      for (let i = 0; i <= 150; i++) {
        const z = 64 - i * 128 / 150, center = creekX(z), y = terrainHeight(key, center, z) + 0.19;
        vertices.push(center - 1.08, y, z, center + 1.08, y, z);
        if (i < 150) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      world.add(new THREE.Mesh(geometry, material));
    }
  }

  function seasonalParticles(key, tier, rand) {
    if (key !== 'snow' && key !== 'autumn') return;
    const count = key === 'snow' ? tier.particles : Math.floor(tier.particles * 0.3);
    const positions = new Float32Array(count * 3), speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rand() - 0.5) * 58;
      positions[i * 3 + 1] = 2 + rand() * 16;
      positions[i * 3 + 2] = (rand() - 0.5) * 96;
      speeds[i] = 0.22 + rand() * 0.58;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: { ...THREE.UniformsLib.fog, color: { value: new THREE.Color(key === 'snow' ? '#eaf3f5' : '#cc8539') }, size: { value: key === 'snow' ? 30 : 110 }, leaf: { value: key === 'autumn' ? 1 : 0 }, time: { value: 0 } },
      vertexShader: `uniform float size;varying float vSeed;\n#include <fog_pars_vertex>\nvoid main(){vSeed=position.x;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(size/-mvPosition.z,1.,18.);gl_Position=projectionMatrix*mvPosition;\n#include <fog_vertex>\n}`,
      fragmentShader: `uniform vec3 color;uniform float leaf;uniform float time;varying float vSeed;\n#include <fog_pars_fragment>\nvoid main(){vec2 p=gl_PointCoord-.5;float a=time*.4+vSeed;mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));p=r*p;float shape=mix(length(p)*2.,length(p*vec2(1.6,.9))*2.,leaf);if(shape>1.)discard;gl_FragColor=vec4(color,(1.-smoothstep(.25,1.,shape))*.75);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n}`,
    });
    animationMaterials.push(material);
    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false;
    world.add(mesh);
    mesh.visible = !reducedMotion;
    particles = { positions, speeds, geometry, key, mesh };
    if (key === 'autumn') {
      const texture = foliageTexture('leaf'); transientTextures.push(texture);
      const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: texture, color: '#dd963c', alphaTest: 0.39, side: THREE.DoubleSide, roughness: 1 }), 420);
      leaves.receiveShadow = true;
      for (let i = 0; i < leaves.count; i++) {
        const z = (rand() - 0.5) * 116, x = pathX(z) + (rand() - 0.5) * 11;
        instance(leaves, i, new THREE.Vector3(x, terrainHeight(key, x, z) + 0.05, z), new THREE.Vector3(0.52 + rand() * 0.47, 0.52 + rand() * 0.47, 1), new THREE.Euler(-Math.PI / 2, 0, rand() * Math.PI), new THREE.Color().setHSL(0.05 + rand() * 0.1, 0.8, 0.57));
      }
      finishInstances(leaves);
    }
  }

  function updateShadow() {
    const ocean = currentScene === 'ocean';
    sunlight.target.position.set(camera.position.x, 0, camera.position.z - 8);
    sunlight.position.copy(sunlight.target.position).add(new THREE.Vector3(-28, ocean ? 21 : 26, -21));
    sunlight.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
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
      renderer.renderLists.dispose();
    }
    scene.environment = null;
    world = new THREE.Group(); scene.add(world);
    collision = []; animationMaterials = []; particles = null;
    currentScene = key;
    const tier = TIERS[currentQuality];
    const rand = randomSeed(key === 'forest' ? 481 : key === 'ocean' ? 925 : key === 'autumn' ? 391 : 808);
    scene.fog = new THREE.Fog(key === 'ocean' ? '#bbced0' : key === 'snow' ? '#c6d5da' : key === 'autumn' ? '#a3a58d' : '#939f91', key === 'ocean' ? 64 : 30, key === 'ocean' ? 235 : key === 'snow' ? 110 : 154);
    scene.background = hdrTexture;
    scene.backgroundIntensity = 0.92;
    scene.backgroundRotation.set(0, key === 'ocean' ? 0.9 : -0.35, 0);
    hemisphere.color.set(key === 'snow' ? '#d4e3f2' : '#e8f2f2');
    hemisphere.groundColor.set(key === 'snow' ? '#7d939b' : '#4e4c32');
    hemisphere.intensity = key === 'snow' ? 1.2 : 0.76;
    sunlight.color.set(key === 'snow' ? '#eff4ff' : key === 'autumn' ? '#ffe4b1' : '#ffe9bf');
    sunlight.intensity = key === 'snow' ? 2.5 : key === 'ocean' ? 3.5 : 4.25;
    sunlight.shadow.mapSize.set(tier.shadow, tier.shadow);
    if (sunlight.shadow.map) { sunlight.shadow.map.dispose(); sunlight.shadow.map = null; }
    scene.environment = hdrTarget.texture;
    scene.environmentIntensity = 0.78;
    ground(key, tier);
    if (key !== 'ocean') trees(key, tier, rand);
    rocks(key, rand); undergrowth(key, tier, rand);
    if (key !== 'snow') scannedDetails(key, rand);
    if (key === 'forest' || key === 'ocean') water(key, tier);
    seasonalParticles(key, tier, rand);
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
    try { renderer.render(scene, camera); } catch (error) { fail(`3D 畫面無法繼續顯示：${error.message}`); }
  }

  function tick(time) {
    frame = null;
    if (disposed || failed || !running) return;
    const dt = lastTime ? Math.min(Math.max((time - lastTime) / 1000, 0), 0.05) : 0;
    lastTime = time; if (!reducedMotion) clockTime += dt;
    move(dt);
    for (const material of animationMaterials) material.uniforms.time.value = clockTime;
    if (particles && !reducedMotion) {
      const { positions, speeds, geometry, key } = particles;
      for (let i = 0; i < speeds.length; i++) {
        positions[i * 3] += Math.sin(clockTime * 0.4 + i) * dt * (key === 'snow' ? 0.12 : 0.26);
        positions[i * 3 + 1] -= speeds[i] * dt;
        if (positions[i * 3 + 1] < terrainHeight(currentScene, positions[i * 3], positions[i * 3 + 2]) + 0.2) positions[i * 3 + 1] = 17;
      }
      geometry.attributes.position.needsUpdate = true;
    }
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
      return { scene: currentScene, quality: currentQuality, running, ready: !disposed && !failed, reducedMotion, position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, rotation: { yaw, pitch }, distance, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      if (disposed) return;
      disposed = true; running = false;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect(); canvas.removeEventListener('webglcontextlost', onContextLost); motionPreference.removeEventListener('change', onMotionPreference);
      if (world) disposeGroup(world, modelGeometries, modelMaterials);
      transientTextures.forEach(texture => texture.dispose());
      textures.forEach(texture => texture.dispose());
      if (hdrTarget) hdrTarget.dispose();
      if (hdrTexture) hdrTexture.dispose();
      modelGeometries.forEach(geometry => geometry.dispose()); modelMaterials.forEach(material => material.dispose()); modelTextures.forEach(texture => texture.dispose());
      sunlight.shadow.dispose(); pmrem.dispose(); renderer.renderLists.dispose(); renderer.dispose();
    },
  };
}

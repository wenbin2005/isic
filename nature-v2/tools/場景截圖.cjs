// 四景固定視角截圖：美化前後比對用。
// 用法：在上層資料夾啟動靜態伺服器（埠 4174）後執行
//   node tools/場景截圖.cjs <輸出資料夾> [forest,ocean,autumn,snow]
// 環境變數：PLAYWRIGHT_PATH（Playwright 位置）、NATURE_URL（伺服器根網址）、NATURE_SOFTWARE=1（無顯示卡時改用 SwiftShader）、
//           NATURE_QUALITY=balanced（改截流暢畫質）。
// 僅在測試端改寫 engine.js 的回應以取得相機，不修改專案檔；requestAnimationFrame 改為手動步進，每張圖只渲染一格，
// 因此軟體渲染再慢也能截到確定的畫面。
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const out = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',') : null;
const base = process.env.NATURE_URL || 'http://127.0.0.1:4174';
const P = Math.PI;
// [名稱, x（'path' 為步道中心、'creek' 為溪畔）, z, yaw, pitch]；start 使用引擎預設起點
const POSES = {
  forest: [['start'], ['side', 'path', 10, -1.35, 0], ['creek', 'creek', 12, -0.15, -0.12], ['edge', -48, -20, P / 2 + 0.25, 0.03], ['up', 'path', 30, -0.3, 0.55]],
  autumn: [['start'], ['side', 'path', 10, -1.35, 0], ['back', 'path', 0, P, 0.05], ['edge', -48, -20, P / 2 + 0.25, 0.03]],
  snow: [['start'], ['side', 'path', 10, -1.35, 0], ['back', 'path', 0, P, 0.05], ['edge', -48, -20, P / 2 + 0.25, 0.03]],
  ocean: [['start'], ['sea', -1, 0, -P / 2, -0.04], ['shore', -1.5, 20, -0.25, -0.03], ['inland', 0, 0, P / 2, 0.02]],
};
(async () => {
  if (!out) throw new Error('請指定截圖輸出資料夾。');
  fs.mkdirSync(out, { recursive: true });
  const args = process.env.NATURE_SOFTWARE === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const queue = [];
    window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    window.cancelAnimationFrame = () => {};
    window.__step = () => { queue.splice(0).forEach(callback => callback(performance.now())); };
  });
  await page.route('**/nature-v2/engine.js', async route => {
    const response = await route.fetch();
    const anchor = '  buildScene(initialScene);\n';
    let body = await response.text();
    if (!body.includes(anchor)) throw new Error('engine.js 結構已變更，找不到 buildScene(initialScene)。');
    body = body.replace(anchor, `${anchor}  window.__qa = { camera, draw: () => draw(), shadow: () => updateShadow(), ground: (x, z) => terrainHeight(currentScene, x, z), path: z => pathX(z), info: () => renderer.info.render };\n`);
    await route.fulfill({ response, body, headers: { ...response.headers(), 'content-type': 'text/javascript' } });
  });
  await page.goto(`${base}/nature-v2/?mode=3d`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__natureV2?.getState().activeMode === '3d', null, { timeout: 300000, polling: 500 });
  if (process.env.NATURE_QUALITY) {
    await page.evaluate(quality => { const select = document.getElementById('quality'); select.value = quality; select.dispatchEvent(new Event('change')); }, process.env.NATURE_QUALITY);
    await page.waitForFunction(quality => window.__natureV2.getState().engine?.quality === quality, process.env.NATURE_QUALITY, { timeout: 300000, polling: 500 });
  }
  await page.click('#enter');
  await page.addStyleTag({ content: '.walk-hint,.walking-controls,.scene-caption,.aim,.touch-controls,#toast,.loading-note{visibility:hidden!important}' });
  const shots = [];
  for (const key of Object.keys(POSES)) {
    if (only && !only.includes(key)) continue;
    await page.evaluate(scene => document.querySelector(`[data-scene=${scene}]`).click(), key);
    await page.waitForFunction(scene => window.__natureV2.getState().scene === scene, key, { timeout: 300000, polling: 500 });
    for (const [name, px, pz, yaw, pitch] of POSES[key]) {
      const started = Date.now();
      const info = await page.evaluate(([name, px, pz, yaw, pitch]) => {
        const qa = window.__qa;
        if (name !== 'start') {
          const x = px === 'path' ? qa.path(pz) : px === 'creek' ? qa.path(pz) + 6.2 : px;
          qa.camera.position.set(x, qa.ground(x, pz) + 1.65, pz);
          qa.camera.rotation.set(pitch, yaw, 0);
        }
        qa.shadow(); qa.draw();
        const gl = document.getElementById('world').getContext('webgl2');
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return { drawCalls: qa.info().calls, triangles: qa.info().triangles };
      }, [name, px, pz, yaw, pitch]);
      await page.screenshot({ path: `${out}/${key}-${name}.jpg`, type: 'jpeg', quality: 88, timeout: 600000 });
      shots.push({ scene: key, pose: name, seconds: (Date.now() - started) / 1000, ...info });
    }
  }
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  const result = { gpu, quality: process.env.NATURE_QUALITY || 'high', shots, errors };
  fs.writeFileSync(`${out}/結果.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})().catch(error => { console.error('FAIL', error.message); process.exit(1); });

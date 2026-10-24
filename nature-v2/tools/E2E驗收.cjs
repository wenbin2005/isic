/* nature-v2 E2E（2026-10-24）：系統 Chrome 無頭模式＋真實顯示卡；只讀網站檔，測試鉤子只在測試端注入。
   用法：在 repo 根目錄起靜態伺服器（例：python -m http.server 4174 --bind 127.0.0.1），
         再執行 node nature-v2/tools/E2E驗收.cjs <輸出資料夾>；輸出資料夾預設為系統暫存區的 nature-v2-e2e。
   環境變數：PLAYWRIGHT_PATH、CHROME_PATH、NATURE_URL（伺服器根網址，預設 http://127.0.0.1:4174）、ONLY（只跑名稱符合此正規式的項目）。
   名稱以「回歸：」開頭的項目對應 2026-10-24 修正的問題（見 ../修正紀錄_20261024.md）。 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = (process.env.NATURE_URL || 'http://127.0.0.1:4174') + '/nature-v2/';
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'nature-v2-e2e');
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const SCENES = ['forest', 'ocean', 'autumn', 'snow'];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let browser, gpuInfo = null;

function assert(condition, message) { if (!condition) throw new Error(message); }
function save() { fs.writeFileSync(path.join(OUT, '結果.json'), JSON.stringify({ time: new Date().toISOString(), base: BASE, gpu: gpuInfo, results }, null, 1)); }
async function check(name, action) {
  if (ONLY && !ONLY.test(name)) return;
  const started = Date.now();
  try {
    const detail = await action();
    results.push({ name, pass: true, seconds: (Date.now() - started) / 1000, detail: detail ?? null });
    console.log(`通過：${name}`);
  } catch (error) {
    results.push({ name, pass: false, seconds: (Date.now() - started) / 1000, error: String(error?.message || error).slice(0, 800) });
    console.log(`失敗：${name}：${String(error?.message || error).slice(0, 300)}`);
  }
  save();
}

/* 每個頁面都注入：WebGL／WebGPU 資源計數、記錄 GPUDevice 與 AudioContext。 */
const HOOKS = () => {
  const e2e = window.__e2e = { gl: { tex: 0, buf: 0, prog: 0 }, gpu: { tex: 0, buf: 0 }, devices: [], audio: [] };
  const wrap = (proto, name, after) => {
    const original = proto?.[name]; if (!original) return;
    proto[name] = function (...args) { const result = original.apply(this, args); after(result, args); return result; };
  };
  const G = window.WebGL2RenderingContext?.prototype;
  wrap(G, 'createTexture', r => { if (r) e2e.gl.tex++; }); wrap(G, 'deleteTexture', (r, a) => { if (a[0]) e2e.gl.tex--; });
  wrap(G, 'createBuffer', r => { if (r) e2e.gl.buf++; }); wrap(G, 'deleteBuffer', (r, a) => { if (a[0]) e2e.gl.buf--; });
  wrap(G, 'createProgram', r => { if (r) e2e.gl.prog++; }); wrap(G, 'deleteProgram', (r, a) => { if (a[0]) e2e.gl.prog--; });
  if (window.GPUDevice) {
    wrap(GPUDevice.prototype, 'createTexture', () => e2e.gpu.tex++); wrap(GPUTexture.prototype, 'destroy', () => e2e.gpu.tex--);
    wrap(GPUDevice.prototype, 'createBuffer', () => e2e.gpu.buf++); wrap(GPUBuffer.prototype, 'destroy', () => e2e.gpu.buf--);
    const requestDevice = GPUAdapter.prototype.requestDevice;
    /* three.js 對 reason==='destroyed' 刻意略過，device.destroy() 不能代表故障；改包一層 lost，讓測試能送出 reason 'unknown'（驅動重置）。 */
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await requestDevice.apply(this, args), realLost = device.lost;
      let simulate;
      const lost = new Promise(resolve => { simulate = resolve; realLost.then(resolve); });
      Object.defineProperty(device, 'lost', { value: lost, configurable: true });
      e2e.devices.push(device); e2e.loseDevice = () => simulate({ reason: 'unknown', message: 'E2E 模擬驅動重置' });
      return device;
    };
  }
  const AudioContextClass = window.AudioContext;
  if (AudioContextClass) window.AudioContext = class extends AudioContextClass { constructor(...args) { super(...args); e2e.audio.push(this); } };
};
/* 讓 engine.js 多掛一個唯讀的 window.__qa（相機、地面高度），用來核對貼地；與 tools/場景截圖.cjs 同一個錨點。 */
async function exposeQa(page) {
  await page.route('**/nature-v2/engine.js', async route => {
    const response = await route.fetch().catch(() => null);
    if (!response) return; // 頁面已關閉
    const anchor = '  buildScene(initialScene);\n';
    let body = await response.text().catch(() => '');
    if (!body) return;
    if (!body.includes(anchor)) throw new Error('engine.js 結構已變更，找不到 buildScene(initialScene)。');
    body = body.replace(anchor, `${anchor}  window.__qa = { ground: (x, z) => terrainHeight(currentScene, x, z) };\n`);
    await route.fulfill({ response, body, headers: { ...response.headers(), 'content-type': 'text/javascript' } }).catch(() => {});
  });
}
async function open(url, { viewport = { width: 1280, height: 720 }, mobile = false, init = [], qa = false, reducedMotion = 'no-preference', route = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion, locale: 'zh-TW' });
  await context.addInitScript(HOOKS);
  for (const script of init) await context.addInitScript(script);
  const page = await context.newPage();
  const errors = [], bad = [];
  page.on('pageerror', error => errors.push(`pageerror：${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console：${message.text().slice(0, 300)}`); });
  page.on('response', response => { if (response.status() >= 400) bad.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => { if (!/^(data|blob|about):/.test(request.url())) bad.push(`失敗 ${request.failure()?.errorText} ${request.url()}`); });
  if (qa) await exposeQa(page);
  if (route) await route(page);
  if (url !== null) await page.goto(BASE + url, { waitUntil: 'load' });
  return { page, context, errors, bad, close: () => context.close() };
}
const state = page => page.evaluate(() => window.__natureV2.getState());
const waitMode = (page, mode, timeout = 90000) => page.waitForFunction(m => window.__natureV2?.getState().activeMode === m, mode, { timeout, polling: 200 });
const waitStatsFor = (page, scene, timeout = 30000) => page.waitForFunction(s => { const st = window.__natureV2.getState(); return st.engine?.scene === s && st.stats?.scene === s && st.stats.fps > 0; }, scene, { timeout, polling: 200 });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 82 });
const noErrors = (session, label = '') => assert(session.errors.length === 0 && session.bad.length === 0, `${label}錯誤：${[...session.errors, ...session.bad].join(' | ').slice(0, 500)}`);
async function selectScene(page, key) {
  if ((await state(page)).scene === key) return;
  await page.evaluate(k => document.querySelector(`[data-scene=${k}]`).click(), key);
  await page.waitForFunction(k => { const s = window.__natureV2.getState(); return s.scene === k && s.engine?.scene === k && document.getElementById('loading-note').hidden; }, key, { timeout: 60000, polling: 200 });
}
/* 期望方向（engine.js move 的座標慣例）：前進 (-sin, -cos)、右移 (cos, -sin)。 */
function expected(direction, yaw) {
  const forward = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
  return { forward, backward: forward.map(v => -v), right, left: right.map(v => -v) }[direction];
}
async function measureMove(page, direction, hold) {
  const a = (await state(page)).engine;
  await hold();
  await page.waitForTimeout(120);
  const b = (await state(page)).engine;
  await page.waitForTimeout(450);
  const c = (await state(page)).engine;
  const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, length = Math.hypot(dx, dz);
  const [ex, ez] = expected(direction, a.rotation.yaw);
  const ground = await page.evaluate(([x, z]) => window.__qa ? window.__qa.ground(x, z) : null, [b.position.x, b.position.z]);
  return { length: +length.toFixed(3), cos: length ? +((dx * ex + dz * ez) / length).toFixed(3) : 0, groundError: ground === null ? null : +Math.abs(b.position.y - (ground + 1.65)).toFixed(4), drift: +Math.hypot(c.position.x - b.position.x, c.position.z - b.position.z).toFixed(4) };
}
const keyFor = { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD' };
async function walkKeys(page, label) {
  const record = {};
  for (const direction of Object.keys(keyFor)) {
    await page.evaluate(() => document.getElementById('recenter').click());
    await page.waitForTimeout(150);
    const m = await measureMove(page, direction, async () => { await page.keyboard.down(keyFor[direction]); await page.waitForTimeout(900); await page.keyboard.up(keyFor[direction]); });
    record[direction] = m;
    assert(m.length > 0.8, `${label}${direction} 位移太小：${m.length}`);
    assert(m.cos > 0.9, `${label}${direction} 方向不符：cos=${m.cos}`);
    assert(m.groundError === null || m.groundError < 0.02, `${label}${direction} 未貼地：${m.groundError}`);
    assert(m.drift < 0.02, `${label}${direction} 放開後仍在移動：${m.drift}`);
  }
  return record;
}
async function live(page) { return page.evaluate(() => ({ gl: { ...window.__e2e.gl }, gpu: { ...window.__e2e.gpu } })); }

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] });
  {
    const s = await open('?mode=classic');
    gpuInfo = await s.page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const adapter = await navigator.gpu?.requestAdapter();
      return { userAgent: navigator.userAgent, webgl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, webgpu: adapter ? `${adapter.info.vendor} ${adapter.info.architecture}` : null };
    });
    await s.close();
  }

  await check('預設網址：自動進入真 3D（WebGPU）、資源全部成功、初次不保存版本偏好、無輸入不自行移動', async () => {
    const s = await open(null), started = Date.now();
    await s.page.goto(BASE, { waitUntil: 'load' });
    await waitMode(s.page, '3d');
    const ready = (Date.now() - started) / 1000;
    const a = await state(s.page);
    assert(a.engine.ready && a.engine.backend === 'webgpu', `backend=${a.engine.backend}`);
    assert(a.engine.drawCalls > 0 && a.engine.triangles > 0, '沒有實際繪製');
    await s.page.waitForTimeout(1500);
    const b = await state(s.page);
    assert(Math.hypot(b.engine.position.x - a.engine.position.x, b.engine.position.z - a.engine.position.z) < 1e-6, '沒有輸入卻移動');
    const saved = await s.page.evaluate(() => localStorage.getItem('nature-v2-mode'));
    assert(saved === null, `初次載入就保存偏好：${saved}`);
    const net = await s.page.evaluate(() => { const list = performance.getEntriesByType('resource'); return { requests: list.length, transferMB: +(list.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) / 1048576).toFixed(1) }; });
    await shot(s.page, '01-首頁-桌面.jpg');
    noErrors(s);
    await s.close();
    return { secondsTo3D: ready, backend: a.engine.backend, drawCalls: a.engine.drawCalls, triangles: a.engine.triangles, ...net };
  });

  for (const [backend, query] of [['webgpu', '?mode=3d'], ['webgl', '?mode=3d&gpu=0']]) {
    if (ONLY && !ONLY.test(backend)) continue;
    const s = await open(query, { qa: true });
    let ok = true;
    await check(`${backend}：載入真 3D 並進入漫步`, async () => {
      await waitMode(s.page, '3d');
      const st = await state(s.page);
      assert(st.engine.backend === backend, `backend=${st.engine.backend}`);
      await s.page.click('#enter');
      const after = await state(s.page);
      assert(after.exploring && await s.page.isVisible('#walking-controls') && await s.page.isVisible('#walk-hint'), '未進入漫步模式');
      return { backend: st.engine.backend };
    }).catch(() => { ok = false; });
    if (results.at(-1)?.pass === false) ok = false;
    for (const key of SCENES) {
      if (!ok) break;
      await check(`${backend}／${key}：四方向實際位移、貼地、放開即停、截圖`, async () => {
        await selectScene(s.page, key);
        await waitStatsFor(s.page, key);
        await s.page.waitForTimeout(1200);
        await shot(s.page, `${backend}-${key}.jpg`);
        const st = await state(s.page);
        assert(st.engine.drawCalls > 0, '沒有 draw calls');
        const moves = await walkKeys(s.page, `${key}/`);
        return { fps: Math.round(st.stats.fps), drawCalls: st.engine.drawCalls, triangles: st.engine.triangles, moves };
      });
    }
    if (ok) {
      await check(`${backend}：空白鍵暫停時按方向鍵不移動、再按繼續`, async () => {
        await s.page.locator('#stage').focus();
        await s.page.keyboard.press('Space');
        const paused = await state(s.page);
        assert(!paused.running && !paused.engine.running, '空白鍵沒有暫停');
        const m = await measureMove(s.page, 'forward', async () => { await s.page.keyboard.down('KeyW'); await s.page.waitForTimeout(600); await s.page.keyboard.up('KeyW'); });
        assert(m.length < 1e-6, `暫停中仍移動 ${m.length}`);
        assert((await s.page.textContent('#walk-play')).includes('繼續'), '按鈕文字未變成繼續');
        await s.page.keyboard.press('Space');
        const resumed = await state(s.page);
        assert(resumed.running && resumed.engine.running, '沒有繼續');
        return { pausedLabel: await s.page.textContent('#status') };
      });
      await check(`${backend}：滑鼠拖曳轉頭；視窗失焦會清除行走輸入`, async () => {
        const before = (await state(s.page)).engine.rotation;
        await s.page.mouse.move(640, 300); await s.page.mouse.down(); await s.page.mouse.move(820, 340, { steps: 8 }); await s.page.mouse.up();
        const after = (await state(s.page)).engine.rotation;
        assert(Math.abs(after.yaw - before.yaw) > 0.2, `yaw 沒變：${before.yaw}→${after.yaw}`);
        await s.page.locator('#stage').focus();
        await s.page.keyboard.down('KeyW'); await s.page.waitForTimeout(300);
        await s.page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await s.page.waitForTimeout(150);
        const a = (await state(s.page)).engine.position; await s.page.waitForTimeout(500); const b = (await state(s.page)).engine.position;
        await s.page.keyboard.up('KeyW');
        assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.01, '失焦後仍在走');
        return { yawDelta: +(after.yaw - before.yaw).toFixed(3) };
      });
      await check(`${backend}：切換流暢畫質三角數下降、切回細緻`, async () => {
        const high = (await state(s.page)).engine;
        await s.page.selectOption('#quality', 'balanced');
        await s.page.waitForFunction(() => window.__natureV2.getState().engine.quality === 'balanced');
        await s.page.waitForTimeout(800);
        const balanced = (await state(s.page)).engine;
        assert(balanced.triangles < high.triangles, `三角數沒有下降：${high.triangles}→${balanced.triangles}`);
        await s.page.selectOption('#quality', 'high');
        await s.page.waitForFunction(() => window.__natureV2.getState().engine.quality === 'high');
        return { high: high.triangles, balanced: balanced.triangles };
      });
      await check(`${backend}：重複切景三輪，GPU 資源不持續增加`, async () => {
        const samples = [];
        for (let round = 0; round < 3; round++) {
          for (const key of [...SCENES.slice(1), SCENES[0]]) { await selectScene(s.page, key); await s.page.waitForTimeout(500); }
          await s.page.waitForTimeout(800);
          samples.push(await live(s.page));
        }
        const pick = sample => backend === 'webgpu' ? sample.gpu : sample.gl;
        const first = pick(samples[0]), last = pick(samples[2]);
        for (const kind of Object.keys(first)) assert(last[kind] <= first[kind] * 1.03 + 4, `${kind} 持續增加：${first[kind]}→${last[kind]}`);
        return samples.map(pick);
      });
      await check(`${backend}：Esc 結束漫步，控制列收起`, async () => {
        await s.page.locator('#stage').focus();
        await s.page.keyboard.press('Escape');
        const st = await state(s.page);
        assert(!st.exploring && !(await s.page.isVisible('#walking-controls')), 'Esc 後仍在漫步');
        noErrors(s, `${backend} 全程`);
      });
    }
    await s.close();
  }

  await check('全螢幕探索：進入時舞台全螢幕，離開全螢幕即結束漫步', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.click('#expand');
    await s.page.waitForFunction(() => document.fullscreenElement?.id === 'stage', null, { timeout: 5000 });
    const inFull = await state(s.page);
    await shot(s.page, '02-全螢幕漫步.jpg');
    await s.page.evaluate(() => document.exitFullscreen());
    await s.page.waitForFunction(() => !document.fullscreenElement && !window.__natureV2.getState().exploring, null, { timeout: 5000 });
    assert(!(await s.page.isVisible('#walking-controls')), '控制列殘留');
    noErrors(s);
    await s.close();
    return { exploringInFullscreen: inFull.exploring };
  });

  await check('對話框：指南／來源／呼吸可開關；開啟時暫停渲染、關閉恢復；呼吸結束清除動畫', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    const out = {};
    for (const [opener, dialog] of [['#guide-open', '#guide-dialog'], ['#source-open', '#source-dialog']]) {
      await s.page.locator(opener).scrollIntoViewIfNeeded(); await s.page.click(opener);
      assert(await s.page.evaluate(d => document.querySelector(d).open, dialog), `${dialog} 沒開`);
      assert(!(await state(s.page)).engine.running, `${dialog} 開著仍在渲染`);
      await s.page.click(`${dialog} .close-dialog`);
      await s.page.waitForTimeout(150);
      assert(!(await s.page.evaluate(d => document.querySelector(d).open, dialog)), `${dialog} 沒關`);
      out[dialog] = 'ok';
    }
    await s.page.evaluate(() => scrollTo(0, 0)); await s.page.waitForTimeout(300);
    assert((await state(s.page)).engine.running, '關閉對話框後沒有恢復渲染');
    await s.page.locator('#breath-open').scrollIntoViewIfNeeded(); await s.page.click('#breath-open');
    await s.page.click('#breath-start'); await s.page.waitForTimeout(1300);
    const phase = await s.page.textContent('#breath-phase');
    assert(phase === '慢慢吸氣', `呼吸階段文字：${phase}`);
    assert(await s.page.evaluate(() => document.querySelector('.breath-visual').classList.contains('running')), '呼吸動畫沒啟動');
    await shot(s.page, '03-呼吸練習.jpg');
    await s.page.click('#breath-dialog .close-dialog'); await s.page.waitForTimeout(200);
    assert(!(await s.page.evaluate(() => document.querySelector('.breath-visual').classList.contains('running'))), '關閉後呼吸動畫殘留');
    assert((await s.page.textContent('#breath-start')) === '開始呼吸練習', '按鈕文字未重設');
    noErrors(s);
    await s.close();
    return { ...out, breath: phase };
  });

  await check('音景：點擊才建立並播放，暫停時靜音，結束漫步一併關閉', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    assert((await s.page.evaluate(() => window.__e2e.audio.length)) === 0, '未點擊就建立 AudioContext');
    await s.page.locator('#sound').scrollIntoViewIfNeeded(); await s.page.click('#sound');
    await s.page.waitForFunction(() => document.getElementById('sound').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    const ctx = await s.page.evaluate(() => window.__e2e.audio.map(a => a.state));
    assert(ctx.length === 1 && ctx[0] === 'running', `AudioContext 狀態：${ctx}`);
    await s.page.evaluate(() => scrollTo(0, 0)); await s.page.click('#enter');
    assert((await s.page.getAttribute('#walk-sound', 'aria-pressed')) === 'true', '漫步控制列音景狀態不同步');
    await s.page.click('#leave');
    assert((await s.page.getAttribute('#sound', 'aria-pressed')) === 'false', '結束漫步後音景仍開著');
    noErrors(s);
    await s.close();
    return { contexts: ctx };
  });

  await check('捲離舞台時暫停 3D、捲回自動恢復', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.locator('#scenes').scrollIntoViewIfNeeded();
    await s.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await s.page.waitForFunction(() => !window.__natureV2.getState().engine.running, null, { timeout: 5000 });
    await s.page.evaluate(() => scrollTo(0, 0));
    await s.page.waitForFunction(() => window.__natureV2.getState().engine.running, null, { timeout: 5000 });
    noErrors(s);
    await s.close();
  });

  await check('真實點擊四季卡片切景（非漫步模式），標題、引擎景色一致', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    const seen = [];
    for (const key of ['ocean', 'autumn', 'snow', 'forest']) {
      await s.page.locator(`[data-scene=${key}]`).scrollIntoViewIfNeeded();
      await s.page.click(`[data-scene=${key}]`);
      await s.page.waitForFunction(k => window.__natureV2.getState().engine?.scene === k && document.getElementById('loading-note').hidden, key, { timeout: 60000 });
      const label = await s.page.textContent('#scene-label'), pressed = await s.page.getAttribute(`[data-scene=${key}]`, 'aria-pressed');
      assert(pressed === 'true', `${key} aria-pressed=${pressed}`);
      seen.push({ key, label });
    }
    noErrors(s);
    await s.close();
    return seen;
  });

  await check('快速連點四個景色：最後狀態一致（app、引擎、標題）且無錯誤', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.evaluate(() => ['ocean', 'autumn', 'snow', 'forest', 'ocean'].forEach(k => document.querySelector(`[data-scene=${k}]`).click()));
    await s.page.waitForTimeout(6000);
    const st = await state(s.page);
    const label = await s.page.textContent('#scene-label');
    const pressed = await s.page.evaluate(() => [...document.querySelectorAll('[data-scene][aria-pressed=true]')].map(b => b.dataset.scene));
    assert(st.activeMode === '3d' && st.engine.ready, `模式=${st.activeMode}`);
    assert(st.scene === st.engine.scene, `app=${st.scene} 引擎=${st.engine.scene}`);
    assert(pressed.length === 1 && pressed[0] === st.scene, `選取按鈕=${pressed}`);
    noErrors(s);
    await s.close();
    return { finalScene: st.scene, label };
  });

  await check('手動選靜態版：載入真實原版 iframe、保存偏好、重新整理仍是靜態版；「試試 3D」回到真 3D 並保存', async () => {
    const s = await open('');
    await waitMode(s.page, '3d');
    await s.page.click('#choose-static');
    await waitMode(s.page, 'classic');
    const frame = s.page.frameLocator('#classic-frame');
    await frame.locator('body').waitFor();
    const frameTitle = await s.page.evaluate(() => document.getElementById('classic-frame').contentDocument?.title);
    assert(await s.page.isVisible('#classic-content') && !(await s.page.isVisible('#three-content')), '畫面沒切到靜態版');
    assert((await s.page.evaluate(() => localStorage.getItem('nature-v2-mode'))) === 'classic', '沒有保存 classic');
    await shot(s.page, '04-靜態版.jpg');
    await s.page.reload({ waitUntil: 'load' });
    await waitMode(s.page, 'classic');
    await s.page.click('#try-three');
    await waitMode(s.page, '3d');
    const st = await state(s.page);
    assert(st.quality === 'balanced' && st.engine.quality === 'balanced', `重試 3D 畫質=${st.quality}`);
    assert((await s.page.evaluate(() => localStorage.getItem('nature-v2-mode'))) === '3d', '沒有保存 3d');
    noErrors(s);
    await s.close();
    return { frameTitle, retryQuality: st.quality };
  });

  await check('?mode=classic 直接使用原版靜態副本，不建立 3D', async () => {
    const s = await open('?mode=classic');
    await waitMode(s.page, 'classic', 10000);
    await s.page.waitForTimeout(800);
    const st = await state(s.page);
    assert(st.engine === null, '仍有 3D 引擎');
    noErrors(s);
    await s.close();
  });

  await check('瀏覽器沒有 WebGL2：自動改用原版靜態版', async () => {
    const s = await open('', { init: [() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : get.call(this, type, ...rest); }; }] });
    await waitMode(s.page, 'classic', 20000);
    const st = await state(s.page);
    assert(/WebGL2/.test(st.reason), `原因：${st.reason}`);
    await s.close();
    return { reason: st.reason };
  });

  await check('WebGL 執行中 context lost：改用原版靜態版', async () => {
    const s = await open('?mode=3d&gpu=0');
    await waitMode(s.page, '3d');
    await s.page.evaluate(() => document.getElementById('world').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await waitMode(s.page, 'classic', 10000);
    const st = await state(s.page);
    await s.close();
    return { reason: st.reason };
  });

  await check('WebGPU 執行中裝置中斷（模擬 lost reason=unknown）：改用原版靜態版', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    const devices = await s.page.evaluate(() => window.__e2e.devices.length);
    await s.page.evaluate(() => window.__e2e.loseDevice());
    await waitMode(s.page, 'classic', 10000);
    const st = await state(s.page);
    await s.close();
    return { devices, reason: st.reason };
  });

  await check('WebGPU 渲染器初始化失敗：依說明應改走 WebGL 3D（不是靜態版）', async () => {
    const s = await open('', {
      route: page => page.route('**/nature-v2/gpu.js', async route => {
        const response = await route.fetch();
        let body = await response.text();
        const anchor = '  await renderer.init();\n';
        if (!body.includes(anchor)) throw new Error('gpu.js 結構已變更');
        body = body.replace(anchor, "  throw new Error('E2E 模擬 WebGPU 初始化失敗');\n");
        await route.fulfill({ response, body, headers: { ...response.headers(), 'content-type': 'text/javascript' } });
      }),
    });
    await s.page.waitForFunction(() => ['3d', 'classic'].includes(window.__natureV2?.getState().activeMode), null, { timeout: 90000 });
    await s.page.waitForTimeout(1500);
    const st = await state(s.page);
    await shot(s.page, '05-WebGPU初始化失敗後.jpg');
    await s.close();
    assert(st.activeMode === '3d' && st.engine?.backend === 'webgl', `實際：activeMode=${st.activeMode}，backend=${st.engine?.backend}，原因=${st.reason}`);
    return { backend: st.engine.backend };
  });

  await check('WebGPU 取得裝置失敗（requestDevice 拒絕）：three.js 內建改走 WebGL2 後端，仍是 3D', async () => {
    const s = await open('', { init: [() => { if (window.GPUAdapter) GPUAdapter.prototype.requestDevice = () => Promise.reject(new Error('E2E 模擬 requestDevice 失敗')); }] });
    await s.page.waitForFunction(() => ['3d', 'classic'].includes(window.__natureV2?.getState().activeMode), null, { timeout: 90000 });
    await s.page.waitForTimeout(2500);
    const st = await state(s.page);
    await shot(s.page, '14-requestDevice失敗後.jpg');
    await s.close();
    assert(st.activeMode === '3d' && st.engine?.ready, `activeMode=${st.activeMode}，原因=${st.reason}`);
    return { backend: st.engine.backend, fps: Math.round(st.stats?.fps || 0) };
  });

  const slowFrames = () => {
    const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window), pending = new Map();
    let id = 0;
    window.requestAnimationFrame = callback => { const my = ++id; pending.set(my, { timer: setTimeout(() => { pending.get(my).frame = raf(time => { pending.delete(my); callback(time); }); }, 120) }); return my; };
    window.cancelAnimationFrame = my => { const item = pending.get(my); if (!item) return; clearTimeout(item.timer); if (item.frame) caf(item.frame); pending.delete(my); };
  };
  await check('低幀率自動降級：細緻 → 流暢 → 原版靜態版，不改動手動偏好', async () => {
    const s = await open(null, { init: [slowFrames] });
    const started = Date.now();
    await s.page.goto(BASE, { waitUntil: 'load' });
    await waitMode(s.page, '3d');
    await s.page.waitForFunction(() => window.__natureV2.getState().quality === 'balanced', null, { timeout: 60000, polling: 250 });
    const toBalanced = (Date.now() - started) / 1000;
    const toastText = await s.page.textContent('#toast');
    await waitMode(s.page, 'classic', 60000);
    const toClassic = (Date.now() - started) / 1000;
    const saved = await s.page.evaluate(() => localStorage.getItem('nature-v2-mode'));
    assert(saved === null, `自動降級保存了偏好：${saved}`);
    await s.close();
    return { toBalanced, toClassic, toastText };
  });
  await check('?mode=3d 低幀率時不自動降級', async () => {
    const s = await open('?mode=3d', { init: [slowFrames] });
    await waitMode(s.page, '3d');
    await s.page.waitForTimeout(26000);
    const st = await state(s.page);
    assert(st.activeMode === '3d' && st.quality === 'high', `模式=${st.activeMode} 畫質=${st.quality}`);
    await s.close();
    return { fps: Math.round(st.stats?.fps || 0) };
  });

  for (const [label, query] of [['WebGPU', '?mode=3d'], ['WebGL', '?mode=3d&gpu=0']]) {
    await check(`${label}：pagehide → pageshow(persisted) 後重新建立 3D 並持續渲染`, async () => {
      const s = await open(query);
      await waitMode(s.page, '3d');
      await waitStatsFor(s.page, 'forest');
      await s.page.evaluate(() => { window.__stale = window.__natureV2.getState().stats; window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      await s.page.waitForFunction(() => window.__natureV2.getState().engine?.ready === true && window.__natureV2.getState().activeMode === '3d', null, { timeout: 60000 });
      const t0 = Date.now(), before = (await state(s.page)).engine;
      const rendered = await s.page.waitForFunction(() => { const st = window.__natureV2.getState(); return st.stats !== window.__stale && st.stats?.fps > 0; }, null, { timeout: 20000, polling: 250 }).then(() => true, () => false);
      const st = await state(s.page);
      await shot(s.page, `12-pageshow後-${label}.jpg`);
      noErrors(s);
      await s.close();
      assert(rendered, `重建後 20 秒內沒有新的幀率數據（engine.running=${st.engine?.running}，backend=${before.backend}）`);
      return { secondsToFirstStats: (Date.now() - t0) / 1000, fps: Math.round(st.stats.fps) };
    });
  }

  await check('減少動態偏好：引擎停用粒子動畫、不顯示準星', async () => {
    const s = await open('?mode=3d', { reducedMotion: 'reduce' });
    await waitMode(s.page, '3d');
    await s.page.click('#enter');
    const st = await state(s.page);
    assert(st.engine.reducedMotion === true, '引擎未偵測減少動態');
    assert(!(await s.page.isVisible('#aim')), '準星仍顯示');
    noErrors(s);
    await s.close();
  });

  for (const [width, height] of [[390, 844], [320, 640]]) {
    await check(`${width}px 手機：無橫向溢出、觸控方向鍵四向行走、右側拖曳轉頭`, async () => {
      const s = await open('?mode=3d', { viewport: { width, height }, mobile: true, qa: true });
      await waitMode(s.page, '3d');
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 0, `橫向溢出 ${overflow}px`);
      await shot(s.page, `06-手機${width}-首頁.jpg`);
      await s.page.tap('#enter');
      assert(await s.page.isVisible('#touch-controls'), '觸控方向鍵沒有出現');
      const cdp = await s.context.newCDPSession(s.page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const moves = {};
      for (const direction of ['forward', 'backward', 'left', 'right']) {
        await s.page.evaluate(() => document.getElementById('recenter').click()); await s.page.waitForTimeout(150);
        const box = await s.page.locator(`[data-move=${direction}]`).boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const m = await measureMove(s.page, direction, async () => { await touch('touchStart', x, y); await s.page.waitForTimeout(900); await touch('touchEnd'); });
        moves[direction] = m;
        assert(m.length > 0.8 && m.cos > 0.9, `${direction}：${JSON.stringify(m)}`);
        assert(m.drift < 0.02, `${direction} 放開後仍在走`);
      }
      const before = (await state(s.page)).engine.rotation.yaw;
      await touch('touchStart', width * 0.75, height * 0.35);
      for (let i = 1; i <= 8; i++) await touch('touchMove', width * 0.75 - i * 12, height * 0.35);
      await touch('touchEnd');
      const after = (await state(s.page)).engine.rotation.yaw;
      assert(Math.abs(after - before) > 0.1, `觸控拖曳沒有轉頭：${before}→${after}`);
      await shot(s.page, `07-手機${width}-漫步.jpg`);
      const walkOverflow = await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(walkOverflow <= 0, `漫步模式橫向溢出 ${walkOverflow}px`);
      noErrors(s);
      await s.close();
      return { moves, yawDelta: +(after - before).toFixed(3) };
    });
  }

  await check('鍵盤可達：第一個 Tab 落在「跳至自然場景」，主要按鈕都有可讀名稱', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.keyboard.press('Tab');
    const first = await s.page.evaluate(() => document.activeElement.className + '|' + document.activeElement.textContent.trim());
    const unnamed = await s.page.evaluate(() => [...document.querySelectorAll('button,select,a[href]')].filter(el => !el.closest('[hidden]') && !(el.getAttribute('aria-label') || el.textContent.trim() || el.title || el.labels?.[0]?.textContent.trim())).map(el => el.id || el.className));
    assert(first.startsWith('skip'), `第一個焦點：${first}`);
    assert(unnamed.length === 0, `沒有名稱的控制項：${unnamed}`);
    await s.close();
    return { first };
  });

  /* ---- 審查發現的回歸測試：預期行為寫成斷言，失敗代表問題重現 ---- */
  await check('回歸：漫步中 WebGPU 裝置中斷降級後按「試試 3D」，漫步控制列不應殘留在首頁', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.click('#enter');
    await s.page.evaluate(() => window.__e2e.loseDevice());
    await waitMode(s.page, 'classic', 10000);
    await s.page.click('#try-three');
    await waitMode(s.page, '3d');
    await s.page.waitForTimeout(1500);
    const leftover = await s.page.evaluate(() => ['walk-hint', 'walking-controls', 'aim', 'touch-controls'].filter(id => !document.getElementById(id).hidden));
    const exploring = (await state(s.page)).exploring;
    await shot(s.page, '08-降級後重試3D-控制列殘留.jpg');
    await s.close();
    assert(leftover.length === 0, `非漫步狀態（exploring=${exploring}）卻仍顯示：${leftover.join('、')}`);
  });
  await check('回歸：WebGL context lost 降級後按「試試 3D」應能回到 3D（不需重新整理）', async () => {
    const s = await open('?mode=3d&gpu=0');
    await waitMode(s.page, '3d');
    await s.page.evaluate(() => document.getElementById('world').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await waitMode(s.page, 'classic', 10000);
    await s.page.click('#try-three');
    const back = await waitMode(s.page, '3d', 20000).then(() => true, () => false);
    const st = await state(s.page);
    await shot(s.page, '13-contextlost後重試3D.jpg');
    await s.close();
    assert(back, `20 秒後 activeMode=${st.activeMode}，原因=${st.reason}`);
  });
  await check('回歸：全螢幕漫步時，操作提示（toast）應在全螢幕畫面內看得到', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.click('#expand');
    await s.page.waitForFunction(() => document.fullscreenElement?.id === 'stage', null, { timeout: 5000 });
    await s.page.click('#recenter');
    await s.page.waitForTimeout(400);
    const info = await s.page.evaluate(() => ({ toast: document.getElementById('toast').textContent, visibleClass: document.getElementById('toast').classList.contains('visible'), insideFullscreen: document.fullscreenElement.contains(document.getElementById('toast')) }));
    await shot(s.page, '09-全螢幕回到起點.jpg');
    await s.close();
    assert(info.insideFullscreen, `toast「${info.toast}」已觸發（visible=${info.visibleClass}），但不在全螢幕元素內，畫面上看不到`);
  });
  await check('回歸：漫步中開著對話框按 Esc，只關對話框、不應同時結束漫步', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await s.page.click('#enter');
    await s.page.evaluate(() => document.getElementById('guide-open').click());
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(300);
    const result = await s.page.evaluate(() => ({ dialogOpen: document.getElementById('guide-dialog').open, exploring: window.__natureV2.getState().exploring }));
    await s.close();
    assert(!result.dialogOpen && result.exploring, `對話框開=${result.dialogOpen}、仍在漫步=${result.exploring}`);
  });
  for (const width of [320, 360]) {
    await check(`回歸：${width}px 漫步時，控制列不應蓋住觸控方向鍵`, async () => {
      const s = await open('?mode=3d', { viewport: { width, height: 640 }, mobile: true });
      await waitMode(s.page, '3d');
      await s.page.tap('#enter');
      const covered = await s.page.evaluate(() => [...document.querySelectorAll('[data-move]')].flatMap(button => {
        const r = button.getBoundingClientRect(), points = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
        return points.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && !button.contains(hit); }).map(([x, y]) => `${button.dataset.move}@${Math.round(x)},${Math.round(y)}→${document.elementFromPoint(x, y).id || document.elementFromPoint(x, y).className}`);
      }));
      await shot(s.page, `10-手機${width}-控制列.jpg`);
      await s.close();
      assert(covered.length === 0, `方向鍵被蓋住的點：${covered.join('；')}`);
    });
  }
  await check('觀察：WebGPU 載入四景時主控台沒有 WGSL／WebGPU 警告', async () => {
    const s = await open(null);
    const warnings = [];
    s.page.on('console', message => { if (/WGSL|WebGPU|smoothstep|shader/i.test(message.text())) warnings.push(`${message.type()}：${message.text().slice(0, 200)}`); });
    await s.page.goto(BASE + '?mode=3d', { waitUntil: 'load' });
    await waitMode(s.page, '3d');
    for (const key of SCENES) { await selectScene(s.page, key); await s.page.waitForTimeout(800); }
    await s.close();
    assert(warnings.length === 0, warnings.join(' | '));
    return { warnings: 0 };
  });

  for (const [width, height, mobile] of [[1280, 720, false], [390, 844, true], [320, 640, true]]) {
    await check(`回歸：${width}px 漫步時提示框不蓋住控制列、方向鍵與結束按鈕`, async () => {
      const s = await open('?mode=3d', { viewport: { width, height }, mobile });
      await waitMode(s.page, '3d');
      if (mobile) await s.page.tap('#enter'); else await s.page.click('#enter');
      await s.page.evaluate(() => document.getElementById('recenter').click());
      await s.page.waitForTimeout(400);
      const hits = await s.page.evaluate(() => {
        const toast = document.getElementById('toast').getBoundingClientRect();
        const overlap = r => toast.left < r.right && toast.right > r.left && toast.top < r.bottom && toast.bottom > r.top;
        return [...document.querySelectorAll('#walking-controls button, #walking-controls select, [data-move], #leave')].filter(el => el.offsetParent && overlap(el.getBoundingClientRect())).map(el => el.id || el.dataset.move || el.textContent.trim());
      });
      const visible = await s.page.evaluate(() => getComputedStyle(document.getElementById('toast')).opacity);
      await shot(s.page, `15-提示框位置-${width}.jpg`);
      await s.close();
      assert(visible === '1', `提示框沒有出現（opacity=${visible}）`);
      assert(hits.length === 0, `提示框蓋住：${hits.join('、')}`);
    });
  }
  await check('回歸：WebGPU 回報的 draw calls 是每幀數值，切景一輪回到同一景不累加', async () => {
    const s = await open('?mode=3d');
    await waitMode(s.page, '3d');
    await waitStatsFor(s.page, 'forest'); await s.page.waitForTimeout(1500);
    const first = (await state(s.page)).engine.drawCalls;
    for (const key of [...SCENES.slice(1), 'forest']) await selectScene(s.page, key);
    await waitStatsFor(s.page, 'forest'); await s.page.waitForTimeout(1500);
    const again = (await state(s.page)).engine.drawCalls;
    await s.close();
    assert(first > 0 && again <= first * 1.25 && again >= first * 0.8, `森林 draw calls：第一次 ${first}、切景一輪後 ${again}`);
    return { first, again };
  });
  await check('回歸：降級訊息沒有雙句號，用語統一為「靜態版」', async () => {
    const reasons = [];
    for (const [query, trigger] of [['?mode=3d&gpu=0', () => document.getElementById('world').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()], ['?mode=3d', () => window.__e2e.loseDevice()]]) {
      const s = await open(query);
      await waitMode(s.page, '3d');
      await s.page.evaluate(trigger);
      await waitMode(s.page, 'classic', 10000);
      reasons.push(await s.page.textContent('#fallback-reason'));
      await s.close();
    }
    const bad = reasons.filter(text => text.includes('。。') || text.includes('輕量版'));
    assert(bad.length === 0, `訊息：${bad.join(' / ')}`);
    return { reasons };
  });

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n合計 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
  save();
}
main().catch(async error => { console.error('FAIL', error); save(); await browser?.close(); process.exit(1); });

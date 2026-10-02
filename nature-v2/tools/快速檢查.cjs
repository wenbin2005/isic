const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/wenbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = process.argv[2];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/nature-v2/?mode=3d', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__natureV2?.getState().activeMode === '3d', null, { timeout: 60000 });
  const rect = s => page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; }, s);
  const layout = { hero: await rect('#hero-copy'), caption: await rect('.scene-caption'), stage: await rect('#stage') };
  const net = await page.evaluate(() => { const t = performance.getEntriesByType('resource'); return { count: t.length, mb: +(t.reduce((n, r) => n + (r.encodedBodySize || 0), 0) / 1048576).toFixed(1) }; });
  await page.click('#enter');
  const result = { layout, net, shots: [] };
  for (const key of ['forest', 'autumn', 'snow', 'ocean']) {
    if (key !== 'forest') { await page.evaluate(k => document.querySelector(`[data-scene=${k}]`).click(), key); }
    await page.waitForFunction(k => window.__natureV2.getState().scene === k, key);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${key}.jpg`, type: 'jpeg', quality: 70 });
    const s = await page.evaluate(() => window.__natureV2.getState());
    result.shots.push({ key, fps: Math.round(s.stats?.fps || 0), tris: s.engine.triangles });
  }
  // 焦點留在控制列按鈕時，移動鍵仍應能走路；空白鍵交給按鈕本身。
  await page.click('#recenter');
  const before = await page.evaluate(() => window.__natureV2.getState().engine.distance);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2000); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({ d: window.__natureV2.getState().engine.distance, focus: document.activeElement.id }));
  result.keyOnButton = { before, after };
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  result.spaceOnButton = await page.evaluate(() => ({ running: window.__natureV2.getState().running, focus: document.activeElement.id }));
  result.gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

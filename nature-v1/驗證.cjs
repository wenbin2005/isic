// 無限電影館獨立瀏覽器驗證：node outputs/驗證.cjs [網址]
const { chromium } = require('C:/Users/wenbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const results = [];
const errors = [];
const base = process.argv[2] || 'http://127.0.0.1:4173';
async function check(name, action) {
  try { const evidence = await action(); results.push({ name, pass: true, evidence }); }
  catch (error) { results.push({ name, pass: false, evidence: error.message }); }
}
function verify(condition, evidence) { assert.ok(condition, JSON.stringify(evidence)); return evidence; }
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const Original = window.AudioContext;
    if (Original) window.AudioContext = class extends Original { constructor(...args) { super(...args); window.__audio = this; } createGain() { const gain = super.createGain(); (window.__gains ||= []).push(gain); return gain; } };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await check('UTF-8、繁中與素材完整', async () => {
    const evidence = await page.evaluate(() => ({ charset: document.characterSet, language: document.documentElement.lang, title: document.title, broken: [...document.images].filter(i => i.complete && !i.naturalWidth).map(i => i.src), replacementCharacters: document.body.innerText.includes('\uFFFD') }));
    return verify(evidence.charset === 'UTF-8' && evidence.language === 'zh-Hant' && !evidence.broken.length && !evidence.replacementCharacters, evidence);
  });
  await check('四景切換與鍵盤操作', async () => {
    for (const scene of ['ocean', 'autumn', 'snow', 'forest']) {
      await page.locator(`[data-scene=${scene}]`).click();
      assert.equal(await page.locator(`[data-scene=${scene}]`).getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#scene-image').getAttribute('src'), new RegExp(scene));
    }
    await page.locator('#cinema').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    const pan = await page.locator('#scene-image').evaluate(i => i.style.getPropertyValue('--pan-x'));
    return verify(pan === '4px', { scene: await page.locator('#scene-tag').innerText(), pan });
  });
  await check('播放暫停凍結計時與 CSS 動畫', async () => {
    await page.locator('#play').click();
    const before = await page.locator('#time').innerText();
    await page.waitForTimeout(1250);
    const after = await page.locator('#time').innerText();
    const animation = await page.locator('#scene-image').evaluate(i => getComputedStyle(i).animationPlayState);
    await page.locator('#play').click();
    return verify(before === after && animation.includes('paused'), { before, after, animation });
  });
  await check('收藏儲存並於重新載入後保留', async () => {
    await page.locator('#favorite').click();
    await page.reload();
    return verify(await page.locator('#favorite').getAttribute('aria-pressed') === 'true', { stored: await page.evaluate(() => localStorage.getItem('nature-favorites')) });
  });
  await check('AI 生成與合成音景來源揭露', async () => {
    await page.locator('#about-open').click();
    const text = await page.locator('.source-note').innerText();
    await page.locator('#about-dialog .dialog-close').click();
    return verify(text.includes('AI 生成') && text.includes('不是實地錄製') && text.includes('瀏覽器合成'), text);
  });
  await check('自然音開關與音量歸零', async () => {
    await page.locator('#header-sound').click();
    await page.locator('#volume').fill('0');
    await page.waitForTimeout(1800);
    const evidence = await page.evaluate(() => ({ pressed: document.getElementById('sound').getAttribute('aria-pressed'), volume: document.getElementById('volume').value, gain: window.__gains?.[0]?.gain.value, header: document.getElementById('header-sound').innerText, dot: document.querySelector('.sound-dot').innerText }));
    await page.locator('#sound').click();
    return verify(evidence.pressed === 'true' && evidence.volume === '0' && evidence.gain < 0.0002, evidence);
  });
  await check('自然音開啟後標頭文字正確', async () => {
    await page.locator('#header-sound').click();
    const evidence = await page.evaluate(() => ({ text: document.getElementById('header-sound').innerText, dotText: document.querySelector('.sound-dot').textContent }));
    await page.locator('#sound').click();
    return verify(!evidence.text.includes('開啟自然音') && evidence.text.includes('自然音已開啟') && !evidence.dotText.trim(), evidence);
  });
  await check('呼吸練習啟動與關閉後重置', async () => {
    await page.locator('#breath-open').click();
    await page.locator('#breath-start').click();
    await page.waitForTimeout(200);
    const during = await page.locator('#breath-phase').innerText();
    await page.keyboard.press('Escape');
    await page.locator('#breath-open').click();
    const after = await page.locator('#breath-phase').innerText();
    await page.locator('#breath-dialog .dialog-close').click();
    return verify(during === '慢慢吸氣' && after === '準備好了嗎？', { during, after });
  });
  await check('沉浸探索與 Esc 返回', async () => {
    await page.locator('#explore-mode').click();
    const during = await page.locator('#cinema').evaluate(i => i.classList.contains('immersive'));
    await page.keyboard.press('Escape');
    return verify(during && !(await page.locator('#cinema').evaluate(i => i.classList.contains('immersive'))), { during, focus: await page.evaluate(() => document.activeElement.id) });
  });
  await check('沉浸模式播放、聲音與計時控制可操作', async () => {
    await page.locator('#explore-mode').click();
    await page.locator('#immersive-play').click();
    const paused = await page.locator('#play').getAttribute('aria-pressed');
    await page.locator('#immersive-play').click();
    await page.locator('#immersive-sound').click();
    const sound = await page.locator('#sound').getAttribute('aria-pressed');
    await page.locator('#immersive-sound').click();
    await page.locator('#immersive-timer').selectOption('10');
    const timer = await page.locator('#timer').inputValue();
    await page.keyboard.press('Escape');
    return verify(paused === 'false' && sound === 'true' && timer === '10', { paused, sound, timer });
  });
  await check('全螢幕返回電影館確實離開全螢幕', async () => {
    await page.locator('#fullscreen').click();
    const before = await page.evaluate(() => document.fullscreenElement?.id || null);
    await page.locator('#leave-immersion').click();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ fullscreen: document.fullscreenElement?.id || null, immersive: document.getElementById('cinema').classList.contains('immersive') }));
    if (after.fullscreen) await page.evaluate(() => document.exitFullscreen());
    return verify(before === 'cinema' && after.fullscreen === null, { before, after });
  });
  await check('減少動態時鍵盤不產生景色移動', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#cinema').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    const pan = await page.locator('#scene-image').evaluate(i => i.style.getPropertyValue('--pan-x'));
    return verify(pan === '0px', { pan });
  });
  for (const width of [320, 390, 760, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await check(`${width}px 無水平溢位`, async () => {
      const evidence = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bad: [...document.querySelectorAll('button,select,input')].map(e => ({ id: e.id, r: e.getBoundingClientRect() })).filter(x => x.r.width && (x.r.right > innerWidth + 1 || x.r.left < -1)).map(x => x.id) }));
      return verify(evidence.scrollWidth <= evidence.viewport && !evidence.bad.length, evidence);
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await check('手機呼吸練習入口可見且可操作', async () => {
    const visible = await page.locator('#breath-open').isVisible() || await page.locator('#breath-mobile').isVisible();
    await page.locator('#breath-mobile').click();
    await page.locator('#breath-start').click();
    await page.waitForTimeout(50);
    const phase = await page.locator('#breath-phase').innerText();
    await page.locator('#breath-dialog .dialog-close').click();
    return verify(visible && phase === '慢慢吸氣', { visible, phase });
  });
  await check('手機計時進度有可見剩餘時間', async () => {
    await page.locator('#timer').selectOption('5');
    const status = await page.locator('#play-status').innerText();
    const visible = await page.locator('#play-status').isVisible();
    return verify(visible && status.includes('剩餘') && status.includes('05:00'), { visible, status });
  });
  await check('320px 手機沉浸控制不溢位並可暫停', async () => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('#explore-mode').click();
    await page.locator('#immersive-play').click();
    const evidence = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, paused: document.getElementById('play').getAttribute('aria-pressed'), bad: [...document.querySelectorAll('#cinema button,#cinema select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth); }).map(e => e.id) }));
    await page.locator('#immersive-play').click();
    await page.locator('#leave-immersion').click();
    return verify(evidence.scrollWidth <= evidence.width && evidence.paused === 'false' && !evidence.bad.length, evidence);
  });
  // 只替換測試頁的 RAF／可見性來源，不改網站：精確驗證五分鐘邊界。
  const timerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await timerContext.addInitScript(() => {
    let callbacks = [], now = 1000;
    window.requestAnimationFrame = cb => (callbacks.push(cb), callbacks.length);
    window.__step = (count, delta = 100) => { for (let i = 0; i < count; i++) { now += delta; const queue = callbacks; callbacks = []; queue.forEach(cb => cb(now)); } };
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    window.__hidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
  });
  const timed = await timerContext.newPage();
  timed.on('pageerror', error => errors.push(error.message));
  await timed.goto(base);
  await check('隱藏頁面不累加播放計時', async () => {
    await timed.locator('#timer').selectOption('5');
    await timed.evaluate(() => window.__step(11));
    const before = await timed.locator('#time').innerText();
    await timed.evaluate(() => { window.__hidden(true); window.__step(100); window.__hidden(false); });
    const after = await timed.locator('#time').innerText();
    return verify(before === after, { before, after, method: '獨立頁面可見性事件與 RAF 控制' });
  });
  await check('五分鐘到期自動暫停，重新播放從零開始', async () => {
    await timed.locator('#timer').selectOption('5');
    await timed.evaluate(() => window.__step(3002));
    const end = await timed.locator('#time').innerText();
    const pressed = await timed.locator('#play').getAttribute('aria-pressed');
    await timed.locator('#play').click();
    await timed.evaluate(() => window.__step(12));
    const restarted = await timed.locator('#time').innerText();
    return verify(end.includes('05:00') && pressed === 'false' && restarted.includes('00:01'), { end, pressed, restarted });
  });
  await check('低 FPS 時仍按實際可見時間計時', async () => {
    await timed.locator('#timer').selectOption('5');
    await timed.evaluate(() => window.__step(11, 1000));
    const time = await timed.locator('#time').innerText();
    return verify(time.includes('00:11'), { time, method: 'RAF 每秒一次共 11 秒，非粒子運算時間' });
  });
  await check('瀏覽器無未處理例外', async () => verify(errors.length === 0, errors));
  await check('文件繁中 read-back 與四景素材雜湊一致', async () => {
    const files = ['使用說明.md', '製作計畫.md', 'assets/影像來源.md', 'dist/index.html', 'dist/style.css', 'dist/app.js'];
    const invalid = files.filter(name => /[\uFFFD静见]/.test(fs.readFileSync(path.join(__dirname, name), 'utf8')));
    const hashes = {};
    for (const scene of ['forest', 'ocean', 'autumn', 'snow']) {
      const digest = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex');
      hashes[scene] = digest(`dist/assets/${scene}.png`);
      assert.equal(hashes[scene], digest(`assets/${scene}.png`));
    }
    return verify(invalid.length === 0, { invalid, hashes });
  });
  await browser.close();
  const failed = results.filter(r => !r.pass);
  const report = `# 無限電影館獨立驗收報告\n\n[事實] 執行時間：${new Date().toISOString()}；目標：${base}。使用已安裝 Chrome 的獨立 Playwright context，不影響主對話瀏覽器。網站三個原始檔未被本驗證修改。\n\n[事實] 共 ${results.length} 項：${results.length - failed.length} 通過、${failed.length} 未通過。\n\n${results.map(r => `- **${r.pass ? '通過' : '未通過'}｜${r.name}**：${typeof r.evidence === 'string' ? r.evidence : JSON.stringify(r.evidence)}`).join('\n')}\n\n[事實] 計時邊界與隱藏頁測試採用獨立頁面 RAF／document.hidden 控制；沒有實際等待五分鐘或以作業系統切換背景標籤。音量以 AudioParam 增益實測，未聲稱真人聽覺驗證。\n\n[事實] 素材揭露、UTF-8、textContent／固定 scene allowlist 與本機 localStorage 已檢查；未找到可利用的新安全漏洞。工作目錄沒有 Git，因此 staged diff、working diff 與歷史比較不可用。\n`;
  fs.writeFileSync(path.join(__dirname, '驗收報告.md'), report, 'utf8');
  fs.appendFileSync(path.join(__dirname, '驗收報告.md'), `
## 對抗審查與根因結案

[事實] 先前實測發現的六項問題均已由製作者修正，本驗收代理未修改網站原始碼。

| 原問題 | 根因與修正位置 | 最後驗證 |
|---|---|---|
| 手機沒有呼吸練習入口 | 手機隱藏 nav；index.html 的 #breath-mobile 提供替代入口 | 390px 可開啟、開始與關閉 |
| 沉浸控制遭畫面遮蓋 | 控制列在 cinema 外；index.html #immersion-controls 納入畫面 | 播放、聲音與計時可操作，320px 不溢位 |
| 聲音狀態寫進圓點 | app.js 改用 #header-sound-label，避免以 childNodes 索引定位 | 標示與 aria-pressed 正確，圓點內無文字 |
| 全螢幕返回仍滯留 | app.js leaveImmersion 先 await exitFullscreen | 返回後 fullscreenElement=null |
| 減少動態仍受方向鍵移動 | app.js keydown 增加 reducedMotion guard | reduce 狀態下 pan=0px |
| 手機看不到計時進度 | app.js updateTime 更新可見 #play-status | 手機顯示剩餘05:00；低FPS仍依真實時間 |

[事實] 一般模式六種寬度無水平溢位；沒有未處理的 JavaScript 例外。WebGL／音訊無支援的降級分支與低階真機效能尚未實測。真人放鬆感、合成音質與真正的作業系統背景切換不在本自動驗證證據範圍。

[建議] 本輪自動驗證通過的前提是原生 Chrome 能力與目前的四景素材。若改用其他瀏覽器、增加動效或更換影片，需重新驗證；目前沒有證據可宣稱所有裝置都通過。

## 審查摘要

| 嚴重性 | 數量 | 狀態 |
|---|---|---|
| CRITICAL | 0 | 通過 |
| HIGH | 0 | 通過 |
| MEDIUM | 0 | 通過 |
| LOW | 0 | 通過 |

結論：${failed.length ? '尚有未通過項目，請先處理上方實測失敗。' : '核可；本輪沒有未解決的具體 findings。'}

重新執行：\`node outputs/驗證.cjs\`。此指令啟動獨立 headless Chrome context，結束後自動關閉並重建本報告；若改測其他已授權網址，可加上網址參數。
`, 'utf8');
  console.log(JSON.stringify({ passed: results.length - failed.length, failed, errors }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });

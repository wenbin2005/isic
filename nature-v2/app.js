import { createPerformanceGate } from './adaptive.js';

const $ = id => document.getElementById(id);
const scenes = {
  forest: { label:'森林漫步', title:'光落下的森林', text:'走在苔蘚與樹影之間，讓心慢慢鬆開。', frequency:850, gain:.12 },
  ocean: { label:'大西洋波浪', title:'把腳步交給海風', text:'沿著岩岸，聽浪潮為今天留一點空白。', frequency:1100, gain:.24 },
  autumn: { label:'秋天落葉', title:'有些放下，像葉子一樣輕', text:'穿過金色林徑，在暖光裡慢慢行走。', frequency:1500, gain:.1 },
  snow: { label:'靜謐雪景', title:'雪落下，世界便安靜了', text:'走在潔白松林裡，只聽見自己的呼吸。', frequency:350, gain:.055 }
};
const params = new URLSearchParams(location.search);
const forced3D = params.get('mode') === '3d';
// WebGPU 試點：瀏覽器支援時森林改走 WebGPU 管線；?gpu=0 可強制使用原本的 WebGL 版本對照。
const gpuAllowed = params.get('gpu') !== '0' && 'gpu' in navigator;
let gpuAdapter = null, explorerGpu = false;
async function hasWebGPU() {
  if (!gpuAllowed) return false;
  if (gpuAdapter === null) { try { gpuAdapter = Boolean(await navigator.gpu.requestAdapter()); } catch { gpuAdapter = false; } }
  return gpuAdapter;
}
const coarse = matchMedia('(pointer: coarse)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let explorer = null, current = 'forest', running = true, exploring = false, activeMode = 'loading';
let quality = 'high', switching = false, starting = false, retryRequested = false, fallbackReason = '';
let lastStats = null, lastSceneChange = 0, toastTimer, gesture = null, pointerLocked = false;
let soundEnabled = false, audio = null, soundBusy = false, birdTime = 0, audioInterval = 0;
let breathStarted = 0, breathFrame = 0;
const input = { forward:false, backward:false, left:false, right:false };
const gate = createPerformanceGate(quality, forced3D);
const keyMap = { KeyW:'forward', ArrowUp:'forward', KeyS:'backward', ArrowDown:'backward', KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right' };

function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
function saveMode(value) { try { localStorage.setItem('nature-v2-mode', value); } catch { /* 裝置儲存不可用不影響體驗。 */ } }
function resetInput() { Object.keys(input).forEach(key => { input[key] = false; }); explorer?.setInput(input); document.querySelectorAll('[data-move]').forEach(button => button.classList.remove('held')); gesture = null; }
function updateSceneUI() {
  const scene = scenes[current];
  $('scene-label').textContent = scene.label; $('scene-title').textContent = scene.title; $('scene-subtitle').textContent = scene.text;
  $('scene-no').textContent = `0${Object.keys(scenes).indexOf(current) + 1} / 04`; $('enter-label').textContent = `走進${scene.label}`;
  document.querySelectorAll('[data-scene]').forEach(button => { const selected = button.dataset.scene === current; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  updateAudio();
}
function updateRunning() {
  explorer?.setRunning(running && !document.hidden);
  $('walk-play').textContent = running ? 'Ⅱ 暫停' : '▶ 繼續';
  $('walk-play').setAttribute('aria-label', running ? '暫停漫步' : '繼續漫步');
  $('status').textContent = running ? `${scenes[current].label} · 慢慢看，慢慢走` : '已暫停，風景會在這裡等你';
  if (!running) resetInput(); updateAudio();
}
function statsUpdate(stats) {
  if (activeMode !== '3d') return;
  lastStats = stats;
  $('distance').textContent = `已漫步 ${Math.floor(stats.distance || 0)} 公尺`;
  $('fps').textContent = `${Math.round(stats.fps)} FPS`;
  if (switching || !running || performance.now() - lastSceneChange < 3000) return;
  const decision = gate.sample({ fps:stats.fps, now:performance.now(), visible:!document.hidden });
  if (decision === 'balanced') { setQuality('balanced', true); toast('已調整為流暢畫質，讓漫步更輕鬆。'); }
  if (decision === 'classic') useClassic('這台裝置持續渲染較慢，已切換為原版靜態體驗。', false);
}
function setQuality(value, automatic = false) {
  quality = value; $('quality').value = value;
  explorer?.setQuality(value); gate.reset(performance.now(), value);
  $('quality-label').textContent = value === 'high' ? '細緻畫質 · 即時 3D' : '流暢畫質 · 即時 3D';
  if (!automatic) toast(value === 'high' ? '已切換細緻畫質' : '已切換流暢畫質');
}
function stopAudio() {
  clearInterval(audioInterval); audioInterval = 0; soundEnabled = false; syncSoundUI();
  if (!audio) return;
  const previousAudio = audio; audio = null;
  previousAudio.gain.gain.setValueAtTime(0, previousAudio.context.currentTime);
  previousAudio.source.stop(); previousAudio.context.close().catch(() => {});
}
async function useClassic(reason, remember = true) {
  if (remember) { retryRequested = false; saveMode('classic'); }
  if (activeMode === 'classic') return;
  activeMode = 'classic'; fallbackReason = reason; resetInput();
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* 全螢幕退出失敗仍保留返回入口。 */ } }
  if (document.pointerLockElement) document.exitPointerLock();
  exploring = false; $('stage').classList.remove('exploring');
  explorer?.dispose(); explorer = null; stopAudio();
  $('three-content').hidden = true; $('classic-content').hidden = false; $('fallback-reason').textContent = reason;
  $('classic-frame').src = './classic/index.html';
  $('try-three').focus();
}
async function start3D() {
  if (starting) { retryRequested = true; toast('正在完成前一次載入，接著會重試 3D 漫遊。'); return; }
  starting = true; activeMode = 'loading'; fallbackReason = '';
  $('three-content').hidden = false; $('classic-content').hidden = true; $('classic-frame').src = 'about:blank';
  $('stage').classList.remove('ready'); $('loading-note').hidden = false; $('loading-note').textContent = '正在鋪好步道、讓光落進樹林…';
  $('enter').disabled = true; $('quality-label').textContent = '正在準備自然場景';
  try {
    const probe = document.createElement('canvas'), context = probe.getContext('webgl2', { failIfMajorPerformanceCaveat:false });
    if (!context) throw new Error('這個瀏覽器未提供 WebGL2，已為你使用原版靜態體驗。');
    context.getExtension('WEBGL_lose_context')?.loseContext();
    const { createExplorer, GPU_SCENES } = await import('./engine.js');
    const onFailure = message => { if (activeMode === '3d' || activeMode === 'loading') useClassic(`3D 場景暫時無法繼續：${message}。已保留原版靜態體驗。`, false); };
    let created = null;
    if (GPU_SCENES.has(current) && await hasWebGPU()) {
      // WebGPU 啟動失敗不算 3D 失敗：換一張新畫布改走 WebGL，不打擾使用者。
      try { created = await createExplorer({ canvas:$('world'), scene:current, quality, gpu:await import('./gpu.js'), onStats:statsUpdate, onFailure }); explorerGpu = true; }
      catch (error) { console.warn('WebGPU 管線無法啟動，改用 WebGL：', error); gpuAdapter = false; freshCanvas(); }
    }
    if (!created) { created = await createExplorer({ canvas:$('world'), scene:current, quality, onStats:statsUpdate, onFailure }); explorerGpu = false; }
    if (activeMode === 'classic') { created.dispose(); return; }
    if (!created.getState().ready) { created.dispose(); throw new Error('3D 場景尚未就緒，已使用原版靜態體驗。'); }
    explorer = created; activeMode = '3d'; running = true;
    $('stage').classList.add('ready'); $('loading-note').hidden = true; $('enter').disabled = false;
    gate.reset(performance.now(), quality); lastSceneChange = performance.now();
    updateSceneUI(); setQuality(quality, true); updateRunning();
  } catch (error) { await useClassic(error.message || '無法載入 3D 場景，已使用原版靜態體驗。', false); }
  finally {
    starting = false;
    if (retryRequested) { retryRequested = false; if (activeMode === 'classic') start3D(); }
  }
}
/** 畫布一旦取得 WebGPU 或 WebGL context 就不能換另一種；切換引擎時換一張同屬性的新畫布。 */
function freshCanvas() {
  const old = $('world'), canvas = old.cloneNode(false);
  old.replaceWith(canvas);
}
async function switchScene(key) {
  if (!scenes[key] || switching || !explorer) return;
  const { GPU_SCENES } = await import('./engine.js');
  if (explorerGpu !== (GPU_SCENES.has(key) && await hasWebGPU())) {
    // 森林（WebGPU）與其他三景（WebGL）之間切換：重建引擎。
    switching = true; resetInput();
    explorer.dispose(); explorer = null; freshCanvas();
    current = key; updateSceneUI();
    try { await start3D(); } finally { switching = false; }
    return;
  }
  switching = true; resetInput();
  const previous = current;
  $('loading-note').textContent = '正在走向下一處景色…'; $('loading-note').hidden = false;
  try { await explorer.setScene(key); current = key; lastSceneChange = performance.now(); gate.reset(lastSceneChange, quality); updateSceneUI(); updateRunning(); }
  catch { current = previous; await useClassic('這處 3D 景色未能載入，請先在原版靜態體驗中放鬆。', false); }
  finally { switching = false; $('loading-note').hidden = true; }
}
function enterWalk() {
  if (activeMode !== '3d') return;
  exploring = true; $('stage').classList.add('exploring'); $('walk-hint').hidden = false; $('walking-controls').hidden = false; $('aim').hidden = reducedMotion.matches; $('touch-controls').hidden = !coarse.matches;
  $('stage').focus(); running = true; updateRunning(); window.dispatchEvent(new Event('resize'));
}
async function leaveWalk() {
  resetInput();
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { toast('請使用瀏覽器返回或 Esc 離開全螢幕。'); return; } }
  exploring = false; $('stage').classList.remove('exploring'); $('walk-hint').hidden = $('walking-controls').hidden = $('touch-controls').hidden = $('aim').hidden = true;
  window.dispatchEvent(new Event('resize')); $('enter').focus();
}
$('enter').onclick = enterWalk; $('leave').onclick = leaveWalk;
$('expand').onclick = async () => { enterWalk(); try { if ($('stage').requestFullscreen) await $('stage').requestFullscreen(); else toast('已開啟沉浸漫步'); } catch { toast('已使用沉浸模式，瀏覽器未允許全螢幕。'); } };
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && exploring) leaveWalk(); });
$('choose-static').onclick = () => useClassic('已依你的選擇，使用完整保留的原版靜態體驗。');
$('try-three').onclick = () => { saveMode('3d'); quality = 'balanced'; start3D(); };
$('walk-play').onclick = () => { running = !running; updateRunning(); };
$('recenter').onclick = () => { resetInput(); explorer?.recenter(); toast('已回到這段步道的起點'); };
$('quality').onchange = () => setQuality($('quality').value);
document.querySelectorAll('[data-scene]').forEach(button => button.onclick = () => switchScene(button.dataset.scene));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && exploring && !document.fullscreenElement) leaveWalk();
  if (!exploring || document.querySelector('dialog[open]') || event.target.closest('select,input')) return;
  // 按過控制列按鈕後焦點留在按鈕上：移動鍵仍要能走路，空白鍵則交還給按鈕本身。
  if (event.target.closest('button') && !keyMap[event.code]) return;
  if (event.code === 'Space') { event.preventDefault(); running = !running; updateRunning(); return; }
  if (!running) return;
  if (keyMap[event.code]) { event.preventDefault(); input[keyMap[event.code]] = true; explorer?.setInput(input); }
});
document.addEventListener('keyup', event => { if (keyMap[event.code]) { input[keyMap[event.code]] = false; explorer?.setInput(input); } });
window.addEventListener('blur', resetInput);
$('stage').addEventListener('pointerdown', event => {
  if (!exploring || !running || event.target.closest('button,select,label,.touch-controls,.walking-controls')) return;
  gesture = { id:event.pointerId, x:event.clientX, y:event.clientY }; $('stage').setPointerCapture(event.pointerId);
});
$('stage').addEventListener('pointermove', event => {
  if (!running || !exploring || !explorer) return;
  if (pointerLocked) explorer.look(event.movementX, event.movementY);
  else if (gesture && gesture.id === event.pointerId) { explorer.look(event.clientX - gesture.x, event.clientY - gesture.y); gesture.x = event.clientX; gesture.y = event.clientY; }
});
['pointerup','pointercancel','lostpointercapture'].forEach(type => $('stage').addEventListener(type, () => { gesture = null; }));
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === $('world'); if (!pointerLocked) resetInput(); });
document.querySelectorAll('[data-move]').forEach(button => {
  const release = () => { input[button.dataset.move] = false; button.classList.remove('held'); explorer?.setInput(input); };
  button.addEventListener('pointerdown', event => { if (!running || !exploring) return; event.preventDefault(); button.setPointerCapture(event.pointerId); input[button.dataset.move] = true; button.classList.add('held'); explorer?.setInput(input); });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type => button.addEventListener(type, release));
});
document.addEventListener('visibilitychange', () => { resetInput(); gate.reset(performance.now(), quality); updateRunning(); });

function makeAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('不支援音訊');
  const context = new AudioContextClass(), buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate), values = buffer.getChannelData(0);
  let noise = 0;
  for (let i = 0; i < values.length; i++) { noise = (noise + (Math.random() * 2 - 1) * .025) / 1.025; values[i] = noise * 3; }
  const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
  const filter = context.createBiquadFilter(); filter.type = 'lowpass'; const gain = context.createGain(); gain.gain.value = 0;
  source.connect(filter); filter.connect(gain); gain.connect(context.destination); source.start(); return { context, source, filter, gain };
}
function syncSoundUI() { ['sound','walk-sound'].forEach(id => { $(id).textContent = soundEnabled ? '♫ 關閉音景' : '♫ 開啟音景'; $(id).setAttribute('aria-pressed', String(soundEnabled)); }); }
function updateAudio() {
  if (!audio) return;
  const time = audio.context.currentTime, scene = scenes[current], audible = soundEnabled && running && activeMode === '3d' && !document.hidden;
  audio.filter.frequency.setTargetAtTime(scene.frequency, time, .4);
  audio.gain.gain.setTargetAtTime(audible ? scene.gain * .45 * (current === 'ocean' ? .7 + .3 * Math.sin(time * .4) : 1) : 0, time, .2);
  if (audible && current === 'forest' && time > birdTime) {
    birdTime = time + 9 + Math.random() * 8;
    const bird = audio.context.createOscillator(), gain = audio.context.createGain(); bird.frequency.setValueAtTime(2400,time); bird.frequency.exponentialRampToValueAtTime(3600,time+.15); bird.frequency.exponentialRampToValueAtTime(2500,time+.3);
    gain.gain.setValueAtTime(0,time); gain.gain.linearRampToValueAtTime(.004,time+.06); gain.gain.exponentialRampToValueAtTime(.0001,time+.4);
    bird.connect(gain); gain.connect(audio.context.destination); bird.start(time); bird.stop(time+.45); bird.onended = () => { bird.disconnect(); gain.disconnect(); };
  }
}
async function toggleSound() {
  if (soundBusy) return; soundBusy = true;
  try { if (!audio) audio = makeAudio(); if (audio.context.state !== 'running') await audio.context.resume(); if (activeMode !== '3d' || !audio) return; soundEnabled = !soundEnabled; syncSoundUI(); updateAudio(); if (!audioInterval) audioInterval = setInterval(updateAudio,1000); }
  catch { toast('瀏覽器暫時無法播放音景，仍可安心欣賞景色。'); }
  finally { soundBusy = false; }
}
$('sound').onclick = $('walk-sound').onclick = toggleSound;

function openDialog(id) { resetInput(); $(id).showModal(); }
$('guide-open').onclick = $('guide-inline').onclick = () => openDialog('guide-dialog'); $('source-open').onclick = () => openDialog('source-dialog'); $('breath-open').onclick = () => openDialog('breath-dialog');
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)) dialog.close(); }));
function stopBreath() { cancelAnimationFrame(breathFrame); breathStarted = 0; document.querySelector('.breath-visual').classList.remove('running'); $('breath-start').textContent = '開始呼吸練習'; $('breath-phase').textContent = '準備好了嗎？'; $('breath-count').textContent = '依照舒服的節奏就好'; }
function breathe(now) { if (!breathStarted) breathStarted = now; const phase = (now-breathStarted)/1000%10; $('breath-phase').textContent = phase<4?'慢慢吸氣':'緩緩吐氣'; $('breath-count').textContent = `${Math.ceil(phase<4?4-phase:10-phase)} 秒`; breathFrame = requestAnimationFrame(breathe); }
$('breath-start').onclick = () => { if (document.querySelector('.breath-visual').classList.contains('running')) stopBreath(); else { document.querySelector('.breath-visual').classList.add('running'); $('breath-start').textContent = '結束練習'; breathFrame = requestAnimationFrame(breathe); } }; $('breath-dialog').addEventListener('close',stopBreath);
window.addEventListener('pagehide', () => { resetInput(); explorer?.dispose(); clearInterval(audioInterval); audio?.context.close().catch(()=>{}); stopBreath(); });
window.addEventListener('pageshow', event => { if (event.persisted) { explorer = null; audio = null; soundEnabled = false; audioInterval = 0; syncSoundUI(); if (activeMode === 'classic') $('classic-frame').src = './classic/index.html'; else start3D(); } });

/* 唯讀觀測，供獨立驗收確認真正相機位移與實際渲染。 */
window.__natureV2 = Object.freeze({ getState:() => ({ activeMode, scene:current, quality, running, exploring, reason:fallbackReason, stats:lastStats, engine:explorer?.getState() || null }) });
let savedMode = null; try { savedMode = localStorage.getItem('nature-v2-mode'); } catch { /* 不要求本機儲存。 */ }
if (params.get('mode') === 'classic' || (!forced3D && savedMode === 'classic')) useClassic('已依你的選擇，使用完整保留的原版靜態體驗。', false);
else start3D();

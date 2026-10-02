/* 無限電影館：生成景色、視線探索與合成自然音景。 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const scenes = {
    forest: { label: '森林漫步', title: '光落下的森林', description: '在層層綠意之間，走一段沒有目的的路。', alt: '陽光穿過綠色森林，照亮苔蘚與蜿蜒步道', frequency: 850, volume: .12 },
    ocean: { label: '大西洋波浪', title: '海的另一端，只有此刻', description: '讓潮汐帶走心事，在海風裡多停留一會兒。', alt: '大西洋岩岸的藍綠色浪潮與海霧', frequency: 1100, volume: .26 },
    autumn: { label: '秋天落葉', title: '每一片葉子，都懂得放下', description: '踏進暖金色的步道，聽風翻過這個季節。', alt: '金橙色秋葉覆蓋的林間步道', frequency: 1500, volume: .10 },
    snow: { label: '靜謐雪景', title: '雪落下，世界便安靜了', description: '在潔白松林裡，給自己一段柔軟的寂靜。', alt: '柔和晨光下白雪覆蓋的松林步道', frequency: 350, volume: .06 }
  };
  const keys = Object.keys(scenes);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 'forest', playing = true, elapsed = 0, limit = 0, lastFrame = 0;
  let soundEnabled = false, audio = null, soundBusy = false, toastTimeout, favorites = [];
  let panX = 0, panY = 0, drag = null, breathStarted = 0, breathFrame = 0;
  try { const saved = JSON.parse(localStorage.getItem('nature-favorites') || '[]'); if (Array.isArray(saved)) favorites = saved.filter(k => keys.includes(k)); } catch { /* 儲存不可用時仍可正常探索。 */ }

  function toast(message) {
    $('toast').textContent = message; $('toast').classList.add('visible');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 4000);
  }
  function syncFavorite() {
    const saved = favorites.includes(current);
    $('favorite').textContent = saved ? '♥' : '♡';
    $('favorite').setAttribute('aria-pressed', String(saved));
    $('favorite').setAttribute('aria-label', `${saved ? '取消收藏' : '收藏'}${scenes[current].label}`);
  }
  function syncPlay() {
    $('cinema').classList.toggle('paused', !playing);
    $('play').textContent = playing ? 'Ⅱ' : '▶';
    $('play').setAttribute('aria-label', playing ? '暫停' : '繼續播放');
    $('play').setAttribute('aria-pressed', String(playing));
    $('immersive-play').textContent = playing ? 'Ⅱ 暫停' : '▶ 繼續';
    $('immersive-play').setAttribute('aria-label', playing ? '暫停景色' : '繼續景色');
    $('play-status').textContent = playing ? '慢慢看，慢慢呼吸' : '已暫停，隨時可以回來';
    document.querySelectorAll('.card-state').forEach(e => { e.firstChild.textContent = playing ? '正在播放 ' : '已暫停 '; });
    updateAudio();
  }
  function setPlaying(value) { playing = value; syncPlay(); }
  function switchScene(key) {
    if (!scenes[key]) return;
    current = key; elapsed = 0; panX = panY = 0;
    const scene = scenes[key], src = `./assets/${key}.png`;
    $('scene-image').src = src; $('scene-image').alt = scene.alt;
    $('scene-image').classList.remove('changed'); void $('scene-image').offsetWidth; $('scene-image').classList.add('changed');
    $('scene-tag').textContent = $('mini-title').textContent = scene.label;
    $('scene-title').textContent = scene.title; $('scene-description').textContent = scene.description;
    $('scene-number').textContent = `0${keys.indexOf(key) + 1} / 04`;
    $('mini-image').src = src;
    document.querySelectorAll('.scene-card').forEach(card => {
      const active = card.dataset.scene === key;
      card.classList.toggle('active', active); card.setAttribute('aria-pressed', String(active));
    });
    syncFavorite(); resetParticles(); updateAudio(); updateTime();
  }
  $('scene-image').addEventListener('error', () => toast('景色載入失敗，請重新整理或確認素材檔案完整。'));
  document.querySelectorAll('[data-scene]').forEach(card => card.addEventListener('click', () => switchScene(card.dataset.scene)));
  $('previous').onclick = () => switchScene(keys[(keys.indexOf(current) + 3) % 4]);
  $('next').onclick = () => switchScene(keys[(keys.indexOf(current) + 1) % 4]);
  $('play').onclick = () => { if (!playing && limit && elapsed >= limit) elapsed = 0; setPlaying(!playing); };
  $('immersive-play').onclick = () => $('play').click();
  $('start').onclick = () => { if (limit && elapsed >= limit) elapsed = 0; setPlaying(true); immerse(); };
  $('favorite').onclick = () => {
    const saved = favorites.includes(current);
    favorites = saved ? favorites.filter(k => k !== current) : [...favorites, current];
    syncFavorite();
    try { localStorage.setItem('nature-favorites', JSON.stringify(favorites)); toast(saved ? '已取消收藏' : '已收藏這處景色'); }
    catch { toast('此瀏覽器無法保存收藏，本次停留期間仍可使用。'); }
  };

  function makeAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('不支援音訊');
    const context = new AudioContextClass();
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const values = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < values.length; i++) { brown = (brown + (Math.random() * 2 - 1) * .025) / 1.025; values[i] = brown * 3; }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass';
    const gain = context.createGain(); gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(context.destination); source.start();
    return { context, filter, gain, birdAt: 0 };
  }
  function updateAudio() {
    if (!audio) return;
    const scene = scenes[current], time = audio.context.currentTime;
    audio.filter.frequency.setTargetAtTime(scene.frequency, time, .5);
    const wave = current === 'ocean' ? .65 + .35 * Math.sin(time * .42) : 1;
    const target = soundEnabled && playing && !document.hidden ? Number($('volume').value) / 100 * scene.volume * wave : 0;
    audio.gain.gain.setTargetAtTime(target, time, .3);
    if (current === 'forest' && soundEnabled && playing && !document.hidden && time > audio.birdAt && Number($('volume').value) > 0) {
      audio.birdAt = time + 7 + Math.random() * 7;
      const bird = audio.context.createOscillator(), birdGain = audio.context.createGain();
      bird.type = 'sine'; bird.frequency.setValueAtTime(2200, time); bird.frequency.exponentialRampToValueAtTime(3600, time + .12); bird.frequency.exponentialRampToValueAtTime(2400, time + .3);
      birdGain.gain.setValueAtTime(0, time); birdGain.gain.linearRampToValueAtTime(Number($('volume').value) / 100 * .012, time + .05); birdGain.gain.exponentialRampToValueAtTime(.0001, time + .4);
      bird.connect(birdGain); birdGain.connect(audio.context.destination); bird.start(time); bird.stop(time + .45);
      bird.onended = () => { bird.disconnect(); birdGain.disconnect(); };
    }
  }
  async function toggleSound() {
    if (soundBusy) return; soundBusy = true;
    try {
      if (!audio) audio = makeAudio();
      if (audio.context.state !== 'running') await audio.context.resume();
      soundEnabled = !soundEnabled;
      $('sound').setAttribute('aria-pressed', String(soundEnabled));
      $('sound').setAttribute('aria-label', soundEnabled ? '關閉自然音' : '開啟自然音');
      $('header-sound').setAttribute('aria-pressed', String(soundEnabled));
      $('immersive-sound').setAttribute('aria-pressed', String(soundEnabled));
      $('immersive-sound').textContent = soundEnabled ? '♫ 關閉自然音' : '♫ 開啟自然音';
      $('header-sound-label').textContent = soundEnabled ? '自然音已開啟' : '開啟自然音';
      updateAudio(); toast(soundEnabled ? '自然音景已開啟，讓呼吸慢下來' : '自然音景已關閉');
    } catch { toast('目前瀏覽器無法播放音訊，仍可欣賞景色。'); }
    finally { soundBusy = false; }
  }
  $('sound').onclick = $('header-sound').onclick = toggleSound;
  $('immersive-sound').onclick = toggleSound;
  $('volume').oninput = () => { $('volume').style.background = `linear-gradient(90deg,#c5d3ad ${$('volume').value}%,#3c4b37 ${$('volume').value}%)`; updateAudio(); };
  $('timer').onchange = () => { limit = Number($('timer').value) * 60; elapsed = 0; $('immersive-timer').value = $('timer').value; updateTime(); toast(limit ? `已設定 ${limit / 60} 分鐘休息時間` : '自由停留，不必趕時間'); };
  $('immersive-timer').onchange = () => { $('timer').value = $('immersive-timer').value; $('timer').dispatchEvent(new Event('change')); };
  function updateTime() {
    const seconds = Math.floor(elapsed), minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    $('time').replaceChildren(document.createTextNode(`${minutes}:${String(seconds % 60).padStart(2, '0')} `));
    const duration = document.createElement('span'); duration.textContent = limit ? `/ ${Math.floor(limit / 60)}:00` : '/ 無限循環'; $('time').append(duration);
    $('progress-fill').style.width = `${limit ? Math.min(elapsed / limit * 100, 100) : (elapsed % 120) / 120 * 100}%`;
    if (limit && playing) { const remaining = Math.max(0, Math.ceil(limit - elapsed)); $('play-status').textContent = `剩餘 ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')} · 慢慢呼吸`; }
    else if (playing) $('play-status').textContent = '慢慢看，慢慢呼吸';
  }
  function immerse() { $('cinema').classList.add('immersive'); $('immersion-help').hidden = false; $('immersion-controls').hidden = false; $('cinema').focus(); resize(); }
  async function leaveImmersion() {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { toast('目前無法離開全螢幕，請按 Esc 或使用瀏覽器返回。'); return; } }
    $('cinema').classList.remove('immersive'); $('immersion-help').hidden = true; $('immersion-controls').hidden = true; resize(); $('explore-mode').focus();
  }
  $('explore-mode').onclick = immerse; $('leave-immersion').onclick = leaveImmersion;
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { if (!$('cinema').requestFullscreen) { immerse(); toast('已使用沉浸模式'); } else { immerse(); await $('cinema').requestFullscreen(); } }
    } catch { immerse(); toast('瀏覽器未允許全螢幕，已開啟沉浸模式。'); }
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) leaveImmersion(); else resize(); });
  $('cinema').addEventListener('keydown', event => {
    if (event.target !== $('cinema')) return;
    const deltas = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] };
    if (deltas[event.key]) { event.preventDefault(); if (!reducedMotion.matches) { panX = Math.max(-18, Math.min(18, panX + deltas[event.key][0])); panY = Math.max(-12, Math.min(12, panY + deltas[event.key][1])); } }
    if (event.key === ' ') { event.preventDefault(); if (!playing && limit && elapsed >= limit) elapsed = 0; setPlaying(!playing); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('cinema').classList.contains('immersive') && !document.fullscreenElement) leaveImmersion(); });
  $('cinema').addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    drag = { x: event.clientX, y: event.clientY, startX: panX, startY: panY };
    $('cinema').setPointerCapture(event.pointerId);
  });
  $('cinema').addEventListener('pointermove', event => {
    if (!playing || reducedMotion.matches) return;
    if (drag) { panX = Math.max(-18, Math.min(18, drag.startX + (event.clientX - drag.x) * .055)); panY = Math.max(-12, Math.min(12, drag.startY + (event.clientY - drag.y) * .035)); }
    else if (event.pointerType === 'mouse') { const rect = $('cinema').getBoundingClientRect(); panX = ((event.clientX - rect.left) / rect.width - .5) * 22; panY = ((event.clientY - rect.top) / rect.height - .5) * 12; }
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => $('cinema').addEventListener(type, () => { drag = null; }));

  function openDialog(id) { $(id).showModal(); }
  $('breath-open').onclick = $('breath-mobile').onclick = () => openDialog('breath-dialog');
  $('about-open').onclick = $('source-open').onclick = () => openDialog('about-dialog');
  document.querySelectorAll('.dialog-close').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  }));
  function stopBreathing() {
    cancelAnimationFrame(breathFrame); breathStarted = 0;
    document.querySelector('.breath-visual').classList.remove('running');
    $('breath-start').textContent = '開始呼吸練習'; $('breath-phase').textContent = '準備好了嗎？'; $('breath-count').textContent = '依照舒服的節奏就好';
  }
  function breathing(now) {
    if (!breathStarted) breathStarted = now;
    const phase = (now - breathStarted) / 1000 % 10;
    $('breath-phase').textContent = phase < 4 ? '慢慢吸氣' : '緩緩吐氣';
    $('breath-count').textContent = `${Math.ceil(phase < 4 ? 4 - phase : 10 - phase)} 秒`;
    breathFrame = requestAnimationFrame(breathing);
  }
  $('breath-start').onclick = () => {
    if (breathStarted || document.querySelector('.breath-visual').classList.contains('running')) stopBreathing();
    else { document.querySelector('.breath-visual').classList.add('running'); $('breath-start').textContent = '結束練習'; breathFrame = requestAnimationFrame(breathing); }
  };
  $('breath-dialog').addEventListener('close', stopBreathing);

  const particleCanvas = $('particles'), ctx = particleCanvas.getContext('2d');
  let particles = [], width = 1, height = 1;
  function resetParticles() {
    particles = Array.from({ length: current === 'snow' ? 65 : current === 'autumn' ? 24 : 20 }, () => ({ x: Math.random() * width, y: Math.random() * height, r: 1 + Math.random() * 3, v: .3 + Math.random() * .7, phase: Math.random() * 6.28 }));
  }
  function resize() {
    const rect = $('cinema').getBoundingClientRect(); width = rect.width; height = rect.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    particleCanvas.width = width * ratio; particleCanvas.height = height * ratio;
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (gl) { $('atmosphere').width = width * ratio; $('atmosphere').height = height * ratio; gl.viewport(0, 0, $('atmosphere').width, $('atmosphere').height); }
    resetParticles();
  }
  function drawParticles(delta, seconds) {
    if (!ctx) return; ctx.clearRect(0, 0, width, height);
    if (reducedMotion.matches || current === 'ocean') return;
    for (const p of particles) {
      p.y += delta * p.v * (current === 'snow' ? 28 : current === 'autumn' ? 15 : -5);
      p.x += Math.sin(seconds * .4 + p.phase) * delta * 6;
      if (p.y > height + 10) p.y = -10; if (p.y < -10) p.y = height + 10;
      ctx.save(); ctx.translate(p.x, p.y);
      if (current === 'autumn') { ctx.rotate(seconds * .35 + p.phase); ctx.fillStyle = '#dcad57aa'; ctx.beginPath(); ctx.ellipse(0, 0, p.r * 2, p.r * .8, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = current === 'snow' ? '#f2f7f6b8' : '#efefb75c'; ctx.beginPath(); ctx.arc(0, 0, current === 'snow' ? p.r * .55 : p.r * .35, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  /* WebGL 僅疊加柔和光霧；不可用時仍保留完整景色與控制。 */
  let gl = null, program = null, timeUniform = null;
  try {
    gl = $('atmosphere').getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (gl) {
      const vertex = 'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
      const fragment = 'precision mediump float;varying vec2 uv;uniform float time;void main(){float light=sin(uv.x*9.+uv.y*3.+time*.08)*.5+.5;float haze=pow(light,5.)*.035;gl_FragColor=vec4(.88,.94,.75,haze);}';
      const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('光霧編譯失敗'); return shader; };
      program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('光霧連結失敗');
      gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0); timeUniform = gl.getUniformLocation(program, 'time');
    }
  } catch { gl = null; $('atmosphere').hidden = true; }
  $('atmosphere').addEventListener('webglcontextlost', event => { event.preventDefault(); gl = null; $('atmosphere').hidden = true; });
  window.addEventListener('resize', resize); resize();
  let animationTime = 0, previousSecond = -1;
  function frame(now) {
    const realDelta = lastFrame ? Math.max(0, (now - lastFrame) / 1000) : 0;
    const delta = Math.min(realDelta, .1); lastFrame = now;
    if (playing && !document.hidden) {
      elapsed += realDelta; animationTime += delta;
      if (limit && elapsed >= limit) { elapsed = limit; setPlaying(false); toast('休息時間到了。帶著這份平靜，慢慢回到今天。'); }
      if (playing) drawParticles(delta, animationTime);
      if (gl && !reducedMotion.matches) { gl.uniform1f(timeUniform, animationTime); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    }
    $('scene-image').style.setProperty('--pan-x', `${panX}px`); $('scene-image').style.setProperty('--pan-y', `${panY}px`);
    if (Math.floor(elapsed) !== previousSecond) { updateTime(); updateAudio(); previousSecond = Math.floor(elapsed); }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { lastFrame = 0; updateAudio(); });
  reducedMotion.addEventListener('change', () => { panX = panY = 0; if (ctx) ctx.clearRect(0, 0, width, height); });
  syncFavorite(); syncPlay(); updateTime(); requestAnimationFrame(frame);
})();

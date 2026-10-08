// 星燈港的配樂與音效：全部用 Web Audio 即時合成，沒有外部音檔。
// 旋律都是為這個遊戲寫的原創曲。瀏覽器規定要等玩家第一次按鍵或點擊後才能發聲，所以由 unlock() 啟動。

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const acc = s => (s === '#' ? 1 : s === 'b' ? -1 : 0);
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
// 'C#5' → MIDI 音高
function midi(s) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(s);
  if (!m) throw new Error('音名格式錯誤：' + s);
  return 12 * (+m[3] + 1) + PC[m[1]] + acc(m[2]);
}
// 'Am'、'G/B'、'Bb' → 墊底和弦、分解和弦、低音
function chord(sym) {
  const m = /^([A-G])([#b]?)(m?)(?:\/([A-G])([#b]?))?$/.exec(sym);
  if (!m) throw new Error('和弦格式錯誤：' + sym);
  const fit = (n, lo) => { n = ((n % 12) + 12) % 12; while (n < lo) n += 12; return n; };
  const root = PC[m[1]] + acc(m[2]), third = m[3] ? 3 : 4, r4 = fit(root, 55);
  return {
    pad: [root, root + third, root + 7].map(n => fit(n, 55)).sort((a, b) => a - b),
    arp: [r4, r4 + third, r4 + 7, r4 + 12, r4 + 12 + third],
    bass: fit(m[4] ? PC[m[4]] + acc(m[5]) : root, 36),
    root: fit(root, 36), third
  };
}

// ---------- 曲目 ----------
// step：一格幾秒；bar：每小節幾格；chords：每小節一個和弦，旋律比和弦長時和弦會重複。
// melody：「音名:格數」，r 是休止，| 只是小節線方便閱讀。
// arp：每小節的分解和弦（0 根音、1 三音、2 五音、3 高八度根音、4 高八度三音，null 休止）。
// bassline：每小節的低音，R 根音（轉位和弦用斜線後的低音）、F 五度、T 三度，加 8 是高八度，. 是休止。
// drums：每個字元一格，x 是打擊。gain：整首的音量。
export const TRACKS = {
  title: {
    step: 0.36, bar: 8, gain: 1, lead: 'flute', pad: 'warm', arpVoice: 'harp', bass: 'bass',
    chords: 'C G/B Am Em/G F C/E Dm G F G Em Am F G G C',
    melody: `E5:3 D5 C5:2 G4:2 | D5:4 B4:2 G4:2 | C5:3 B4 A4:2 E4:2 | G4:6 r:2 |
             A4:3 B4 C5:2 F5:2 | E5:3 D5 C5:2 E5:2 | D5:3 C5 A4:2 D5:2 | B4:6 r:2 |
             A4:2 C5:2 F5:3 E5 | D5:2 B4:2 G4:4 | G4:2 B4:2 E5:3 D5 | C5:6 A4:2 |
             F5:3 E5 D5:2 C5:2 | D5:3 C5 B4:2 G4:2 | B4:2 C5:2 D5:4 | C5:8`,
    arp: [0, 1, 2, 3, 4, 3, 2, 1], bassline: 'R:8'
  },
  town: {
    step: 0.26, bar: 6, gain: 1, lead: 'flute', arpVoice: 'harp', bass: 'bass',
    chords: 'F C/E Dm Bb F C Bb C Dm Bb F C Dm Bb C F',
    melody: `A4:3 G4 A4 C5 | G4:3 E4:3 | F4:3 E4 F4 A4 | F4:3 D4:3 |
             A4:3 G4 A4 C5 | E5:3 D5 C5:2 | D5:2 C5 Bb4:2 A4 | G4:6 |
             A4:2 D5 C5:2 A4 | Bb4:3 F4:3 | A4:2 C5 F5:3 | E5:3 C5:3 |
             D5:2 E5 F5:2 D5 | C5:2 Bb4 A4:2 F4 | G4:2 A4 Bb4:2 E4 | F4:6`,
    arp: [0, 2, 3, 4, 3, 2], bassline: 'R:3 F:3', drums: { shaker: '...x..' }
  },
  forest: {
    step: 0.32, bar: 8, gain: 1, lead: 'flute', pad: 'dark', arpVoice: 'pluck', bass: 'bass',
    chords: 'Am G F Em Am G F E',
    melody: `r:2 E5:2 D5 C5 D5:2 | B4:6 r:2 | r:2 A4:2 C5 D5 E5:2 | B4:6 r:2 |
             r:2 A5:2 G5 E5 D5:2 | E5:4 D5:2 B4:2 | C5:3 D5 C5:2 A4:2 | G#4:6 r:2 |
             r:8 | r:4 B4:2 D5:2 | C5:6 r:2 | r:4 G4:2 B4:2 |
             A4:3 B4 C5:2 E5:2 | D5:6 r:2 | C5:3 B4 A4:2 C5:2 | B4:6 r:2`,
    arp: [0, null, 2, null, 3, null, 2, null], bassline: 'R:4 F:4', drums: { shaker: '..x...x.' }
  },
  ruins: {
    step: 0.4, bar: 8, gain: 1.2, lead: 'bell', pad: 'dark', bass: 'bass',
    chords: 'Em F Em D C F Em Em',
    melody: `B4:4 G4:2 E5:2 | C5:6 A4:2 | B4:3 G4 F4:2 E4:2 | F#4:6 r:2 |
             G4:4 E5:2 C5:2 | F5:4 E5 C5 A4:2 | B4:8 | r:8 |
             r:8 | r:4 C5:2 A4:2 | B4:4 E5:4 | D5:6 r:2 |
             E5:3 D5 C5:2 G4:2 | A4:4 C5:4 | B4:8 | r:8`,
    bassline: 'R:8'
  },
  battle: {
    step: 0.19, bar: 8, gain: 1, lead: 'lead', arpVoice: 'pluck', bass: 'bassSaw',
    chords: 'Am F G Em Am F Dm E F G Em Am F G E E',
    melody: `A4:2 C5:2 E5:3 D5 | C5:2 A4:2 F4:4 | G4:2 B4:2 D5:3 C5 | B4:2 G4:2 E4:4 |
             A4:2 C5:2 E5:2 A5:2 | G5:2 F5:2 E5:2 C5:2 | D5:2 F5:2 A5:2 F5:2 | G#4:4 B4:4 |
             F5:3 E5 C5:2 A4:2 | B4:3 C5 D5:2 G5:2 | E5:3 D5 B4:2 G4:2 | A4:2 C5:2 E5:4 |
             F5:2 E5:2 F5:2 A5:2 | G5:3 F5 D5:2 B4:2 | E5:2 D5:2 B4:2 G#4:2 | B4:4 r:4`,
    arp: [0, 2, 3, 2, 1, 2, 3, 2], bassline: 'R R8 R R8 R R8 R R8',
    drums: { kick: 'x...x.x.', snare: '..x...x.', hat: '.x.x.x.x' }
  },
  boss: {
    step: 0.18, bar: 8, gain: 1, lead: 'lead', pad: 'dark', bass: 'bassSaw',
    chords: 'Dm Bb Gm A Dm Bb Eb A Gm Dm Bb A Gm Dm Eb A',
    melody: `D5:3 A4:3 D5:2 | F5:3 D5:3 Bb4:2 | G5:3 F5 D5:2 Bb4:2 | C#5:4 E5:4 |
             D5:2 E5:2 F5:2 A5:2 | Bb5:3 A5 F5:2 D5:2 | G5:3 F5 Eb5:2 Bb4:2 | A4:2 C#5:2 E5:2 G5:2 |
             Bb4:3 D5:3 G5:2 | F5:3 E5 D5:2 A4:2 | Bb4:2 D5:2 F5:2 Bb5:2 | A5:4 E5:2 C#5:2 |
             G5:3 F5 D5:2 Bb4:2 | A4:2 D5:2 F5:3 E5 | Eb5:3 G5 Bb5:2 G5:2 | A5:6 r:2`,
    bassline: 'R R R8 R R R8 F R8',
    drums: { kick: 'x..x..x.', snare: '....x...', hat: 'xxxxxxxx' }
  }
};

// 「E5:3 D5 r:2」→ [{ n, at, len }]
function parseMelody(text) {
  const notes = []; let at = 0;
  for (const tok of text.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [name, len] = tok.split(':'), L = +(len || 1);
    if (name !== 'r') notes.push({ n: midi(name), at, len: L });
    at += L;
  }
  return { notes, len: at };
}

// 把曲目展開成「每一格要發的音」
export function compileTrack(def) {
  const chords = def.chords.trim().split(/\s+/).map(chord), B = def.bar, mel = parseMelody(def.melody);
  const total = Math.max(chords.length * B, mel.len);
  const steps = Array.from({ length: total }, () => []);
  for (const x of mel.notes) steps[x.at].push({ v: def.lead, n: x.n, d: x.len });
  for (let bar = 0; bar < total / B; bar++) {
    const c = chords[bar % chords.length], s0 = bar * B;
    if (def.pad) steps[s0].push({ v: 'pad', tone: def.pad, ns: c.pad, d: B });
    def.arp?.forEach((k, j) => { if (k != null) steps[s0 + j].push({ v: def.arpVoice, n: c.arp[k], d: 2 }); });
    let q = 0;
    for (const tok of def.bassline.split(/\s+/)) {
      const [sym, len] = tok.split(':'), L = +(len || 1);
      if (sym !== '.') steps[s0 + q].push({ v: def.bass, n: (sym[0] === 'R' ? c.bass : c.root + (sym[0] === 'F' ? 7 : c.third)) + (sym.endsWith('8') ? 12 : 0), d: L });
      q += L;
    }
    for (const [v, pat] of Object.entries(def.drums || {})) for (let j = 0; j < B; j++) if (pat[j % pat.length] === 'x') steps[s0 + j].push({ v });
  }
  return steps;
}

// ---------- 合成器 ----------
// 建立在任何 AudioContext（含離線算圖用的 OfflineAudioContext）上：主音量 → 壓縮器（防止破音）→ 輸出，另有共用殘響。
export function createSynth(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
  const master = ctx.createGain(); master.gain.value = 0.85;
  master.connect(comp); comp.connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulse(1.8); verb.connect(master);
  // 配樂壓低一些，讓音效浮在上面
  const bus = (level, send) => { const g = ctx.createGain(), s = ctx.createGain(); g.gain.value = level; s.gain.value = send; g.connect(master); g.connect(s); s.connect(verb); return g; };
  const musicBus = bus(0.5, 0.32), sfxBus = bus(1, 0.16);

  function impulse(sec) {
    const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return buf;
  }
  const noiseBuf = (() => { const n = ctx.sampleRate, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; })();

  // 包絡：a 起音、decay/sustain 衰減到的比例、dur 之後以 rel 收尾
  function env(g, t, { peak, a = 0.005, decay = 0, sustain = 1, dur = 0.1, rel = 0.1 }) {
    const end = t + Math.max(a, dur);
    g.gain.value = 0; // 預設是 1；不先歸零的話，聲音起點若落在取樣點之間會漏出一個爆音
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (decay) g.gain.setTargetAtTime(peak * sustain, t + a, decay);
    g.gain.setTargetAtTime(0, end, rel / 5);
    return end + rel + 0.05;
  }
  function tone(t, f, o) {
    const { type = 'sine', out = sfxBus, lp = 0, q = 0.7, bend = 0, bendT, vib = 0, detune = 0 } = o;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.detune.value = detune;
    osc.frequency.setValueAtTime(f, t);
    if (bend) osc.frequency.exponentialRampToValueAtTime(f * bend, t + (bendT || o.dur || 0.1));
    let node = osc;
    if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; fl.Q.value = q; osc.connect(fl); node = fl; }
    node.connect(g); g.connect(out);
    const stop = env(g, t, o);
    if (vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * vib, t + 0.4);
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(stop);
    }
    osc.start(t); osc.stop(stop);
  }
  function noise(t, o) {
    const { out = sfxBus, type = 'bandpass', f = 1000, f2 = 0, q = 1 } = o;
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + (o.dur || 0.1));
    s.connect(fl); fl.connect(g); g.connect(out);
    const stop = env(g, t, o);
    s.start(t, Math.random() * 0.8); s.stop(stop);
  }

  // ---------- 樂器 ----------
  const INST = {
    flute(t, e, len, out) {
      const f = hz(e.n);
      tone(t, f, { type: 'triangle', peak: 0.13, a: 0.05, decay: 0.5, sustain: 0.75, dur: len * 0.9, rel: 0.25, vib: 0.006, out });
      tone(t, f * 2, { type: 'sine', peak: 0.018, a: 0.06, dur: len * 0.8, rel: 0.2, out });
    },
    lead(t, e, len, out) { tone(t, hz(e.n), { type: 'square', lp: 2600, peak: 0.055, a: 0.008, decay: 0.12, sustain: 0.6, dur: len * 0.85, rel: 0.08, out }); },
    bell(t, e, len, out) {
      const f = hz(e.n);
      tone(t, f, { peak: 0.09, a: 0.003, decay: 0.7, sustain: 0, dur: len, rel: 0.4, out });
      tone(t, f * 2.76, { peak: 0.022, a: 0.002, decay: 0.25, sustain: 0, dur: len * 0.6, rel: 0.2, out });
      tone(t, f * 5.4, { peak: 0.008, a: 0.002, decay: 0.1, sustain: 0, dur: 0.3, rel: 0.1, out });
    },
    harp(t, e, len, out) { tone(t, hz(e.n), { type: 'triangle', peak: 0.06, a: 0.003, decay: 0.3, sustain: 0, dur: len, rel: 0.3, out }); },
    pluck(t, e, len, out) { tone(t, hz(e.n), { type: 'square', lp: 1600, peak: 0.03, a: 0.003, decay: 0.12, sustain: 0, dur: len, rel: 0.15, out }); },
    bass(t, e, len, out) { tone(t, hz(e.n), { type: 'triangle', peak: 0.17, a: 0.01, decay: 0.4, sustain: 0.6, dur: len * 0.92, rel: 0.12, out }); },
    bassSaw(t, e, len, out) { tone(t, hz(e.n), { type: 'sawtooth', lp: 650, q: 2, peak: 0.08, a: 0.005, decay: 0.12, sustain: 0.55, dur: len * 0.8, rel: 0.06, out }); },
    pad(t, e, len, out) {
      const fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = 'lowpass'; fl.frequency.value = e.tone === 'dark' ? 650 : 950; fl.Q.value = 0.5;
      fl.connect(g); g.connect(out);
      const stop = env(g, t, { peak: 0.02, a: 0.9, dur: len, rel: 1.2 });
      for (const n of e.ns) for (const dt of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = dt;
        o.connect(fl); o.start(t); o.stop(stop);
      }
    },
    kick(t, e, len, out) { tone(t, 150, { peak: 0.3, a: 0.002, decay: 0.09, sustain: 0, dur: 0.18, rel: 0.1, bend: 0.3, bendT: 0.12, out }); },
    snare(t, e, len, out) {
      noise(t, { f: 1900, q: 0.7, peak: 0.14, a: 0.002, decay: 0.06, sustain: 0, dur: 0.14, rel: 0.06, out });
      tone(t, 190, { type: 'triangle', peak: 0.1, a: 0.002, decay: 0.04, sustain: 0, dur: 0.08, rel: 0.05, out });
    },
    hat(t, e, len, out) { noise(t, { type: 'highpass', f: 7000, peak: 0.04, a: 0.001, decay: 0.02, sustain: 0, dur: 0.04, rel: 0.03, out }); },
    shaker(t, e, len, out) { noise(t, { f: 6000, q: 1.2, peak: 0.03, a: 0.02, decay: 0.03, sustain: 0, dur: 0.06, rel: 0.04, out }); }
  };
  function voice(e, t, step, out = musicBus) { INST[e.v](t, e, (e.d || 1) * step, out); }

  // ---------- 音效 ----------
  const arp = (t, notes, gap, o) => notes.forEach((n, i) => tone(t + i * gap, hz(midi(n)), o));
  const bellAt = (t, n, peak = 0.08, out = sfxBus) => { const f = hz(midi(n)); tone(t, f, { peak, a: 0.002, decay: 0.5, sustain: 0, dur: 1, rel: 0.4, out }); tone(t, f * 2.76, { peak: peak * 0.25, a: 0.002, decay: 0.2, sustain: 0, dur: 0.5, rel: 0.2, out }); };
  const thud = (t, peak = 0.3) => { tone(t, 170, { peak, a: 0.002, decay: 0.06, sustain: 0, dur: 0.14, rel: 0.08, bend: 0.35 }); noise(t, { type: 'lowpass', f: 900, peak: peak * 0.4, a: 0.002, decay: 0.04, sustain: 0, dur: 0.06, rel: 0.04 }); };
  const SFX = {
    cursor: t => tone(t, 1180, { type: 'square', lp: 3500, peak: 0.08, a: 0.002, dur: 0.025, rel: 0.03 }),
    confirm: t => { tone(t, 880, { type: 'triangle', peak: 0.11, dur: 0.05, rel: 0.05 }); tone(t + 0.05, 1320, { type: 'triangle', peak: 0.11, dur: 0.07, rel: 0.12 }); },
    cancel: t => { tone(t, 700, { type: 'triangle', peak: 0.1, dur: 0.05, rel: 0.05 }); tone(t + 0.05, 470, { type: 'triangle', peak: 0.1, dur: 0.07, rel: 0.1 }); },
    deny: t => { tone(t, 150, { type: 'square', lp: 900, peak: 0.07, dur: 0.06, rel: 0.04 }); tone(t + 0.09, 120, { type: 'square', lp: 900, peak: 0.07, dur: 0.08, rel: 0.06 }); },
    text: t => tone(t, 520 + Math.random() * 70, { type: 'square', lp: 1800, peak: 0.03, a: 0.002, dur: 0.018, rel: 0.02 }),
    next: t => tone(t, 990, { peak: 0.1, a: 0.003, dur: 0.04, rel: 0.1 }),
    open: t => { tone(t, 660, { type: 'triangle', peak: 0.08, dur: 0.05, rel: 0.06 }); tone(t + 0.06, 990, { type: 'triangle', peak: 0.08, dur: 0.06, rel: 0.12 }); },
    encounter: t => {
      noise(t, { f: 300, f2: 4200, q: 2, peak: 0.16, a: 0.05, dur: 0.45, rel: 0.15 });
      arp(t + 0.05, ['A4', 'E5', 'A5', 'E6'], 0.05, { type: 'square', lp: 3000, peak: 0.05, dur: 0.05, rel: 0.06 });
    },
    // 攻擊命中：依屬性換聲音；打中我方是較悶的受擊聲
    hit: (t, { type, weak, party } = {}) => {
      if (party) { tone(t, 240, { type: 'square', lp: 1100, peak: 0.08, dur: 0.1, rel: 0.06, bend: 0.5 }); thud(t, 0.32); }
      else if (type === 'fire') {
        noise(t, { type: 'lowpass', f: 1500, f2: 400, peak: 0.24, a: 0.01, decay: 0.15, sustain: 0.3, dur: 0.35, rel: 0.15 });
        for (let i = 0; i < 5; i++) noise(t + 0.03 + Math.random() * 0.25, { type: 'highpass', f: 3000, peak: 0.05, a: 0.001, dur: 0.012, rel: 0.02 });
        thud(t, 0.18);
      } else if (type === 'wind') {
        noise(t, { f: 500, f2: 2600, q: 3, peak: 0.2, a: 0.04, dur: 0.22, rel: 0.12 });
        noise(t + 0.18, { f: 2600, f2: 700, q: 3, peak: 0.12, a: 0.02, dur: 0.16, rel: 0.1 });
      } else if (type === 'light') {
        arp(t, ['C6', 'G6', 'C7'], 0.035, { peak: 0.06, a: 0.002, decay: 0.15, sustain: 0, dur: 0.3, rel: 0.2 });
        noise(t, { type: 'highpass', f: 6000, peak: 0.05, a: 0.02, dur: 0.2, rel: 0.15 });
      } else if (type === 'staff') thud(t, 0.38);
      else { noise(t, { f: 4500, f2: 900, q: 1.5, peak: 0.22, a: 0.003, dur: 0.11, rel: 0.05 }); thud(t + 0.02, 0.26); }
      if (weak) { tone(t + 0.04, 1568, { peak: 0.06, a: 0.002, decay: 0.12, sustain: 0, dur: 0.25, rel: 0.1 }); tone(t + 0.04, 2349, { peak: 0.04, a: 0.002, decay: 0.1, sustain: 0, dur: 0.2, rel: 0.1 }); }
    },
    cast: t => { tone(t, 330, { peak: 0.06, a: 0.05, dur: 0.25, rel: 0.1, bend: 2.6 }); noise(t, { type: 'highpass', f: 5000, peak: 0.03, a: 0.08, dur: 0.25, rel: 0.1 }); },
    guard: t => { tone(t, 620, { type: 'triangle', peak: 0.12, a: 0.002, decay: 0.12, sustain: 0, dur: 0.3, rel: 0.2 }); tone(t, 930, { type: 'triangle', peak: 0.05, a: 0.002, decay: 0.1, sustain: 0, dur: 0.25, rel: 0.2 }); },
    escape: t => { noise(t, { f: 3000, f2: 400, q: 1.5, peak: 0.14, a: 0.02, dur: 0.35, rel: 0.1 }); arp(t, ['E5', 'C5', 'A4'], 0.07, { type: 'triangle', peak: 0.07, dur: 0.06, rel: 0.06 }); },
    dark: t => { tone(t, 220, { type: 'sawtooth', lp: 700, peak: 0.1, a: 0.02, dur: 0.45, rel: 0.2, bend: 0.3 }); noise(t, { type: 'lowpass', f: 600, peak: 0.16, a: 0.08, dur: 0.4, rel: 0.25 }); },
    boost: (t, { level = 1 } = {}) => tone(t, 520 * Math.pow(1.26, level), { type: 'square', lp: 3000, peak: 0.1, a: 0.002, decay: 0.06, sustain: 0.3, dur: 0.08, rel: 0.06 }),
    break: t => {
      noise(t, { type: 'highpass', f: 1800, peak: 0.24, a: 0.002, decay: 0.08, sustain: 0.2, dur: 0.25, rel: 0.15 });
      for (let i = 0; i < 6; i++) tone(t + Math.random() * 0.2, 2000 + Math.random() * 2600, { peak: 0.035, a: 0.001, decay: 0.08, sustain: 0, dur: 0.2, rel: 0.1 });
      thud(t, 0.36);
    },
    heal: t => arp(t, ['C5', 'E5', 'G5', 'C6'], 0.05, { peak: 0.06, a: 0.004, decay: 0.3, sustain: 0, dur: 0.6, rel: 0.3 }),
    revive: t => { SFX.heal(t); bellAt(t + 0.2, 'G6', 0.06); },
    sp: t => arp(t, ['E6', 'B6'], 0.06, { peak: 0.05, a: 0.003, decay: 0.15, sustain: 0, dur: 0.3, rel: 0.15 }),
    vanish: t => { tone(t, 620, { type: 'square', lp: 2200, peak: 0.06, a: 0.005, dur: 0.4, rel: 0.1, bend: 0.22 }); noise(t, { type: 'highpass', f: 5000, f2: 800, peak: 0.08, a: 0.05, dur: 0.4, rel: 0.15 }); },
    down: t => tone(t, 330, { type: 'triangle', peak: 0.11, a: 0.005, dur: 0.3, rel: 0.1, bend: 0.5 }),
    phase: t => {
      tone(t, 55, { peak: 0.22, a: 0.02, decay: 1, sustain: 0.2, dur: 1.4, rel: 0.6 });
      tone(t, 110, { type: 'sawtooth', lp: 420, peak: 0.08, a: 0.1, dur: 1.2, rel: 0.5, bend: 0.7 });
      noise(t, { type: 'lowpass', f: 300, peak: 0.2, a: 0.6, dur: 1.2, rel: 0.6 });
    },
    victory: t => {
      const o = { type: 'square', lp: 3200, peak: 0.05, a: 0.004, decay: 0.2, sustain: 0.6, rel: 0.1 };
      arp(t, ['G4', 'C5', 'E5'], 0.1, { ...o, dur: 0.08 });
      tone(t + 0.3, hz(midi('G5')), { ...o, dur: 0.32 });
      tone(t + 0.66, hz(midi('E5')), { ...o, dur: 0.1 });
      tone(t + 0.8, hz(midi('G5')), { ...o, dur: 0.75, rel: 0.4 });
      for (const n of ['C5', 'E5', 'G5', 'C6']) tone(t + 0.8, hz(midi(n)), { type: 'triangle', peak: 0.05, a: 0.01, decay: 0.8, sustain: 0.4, dur: 1.2, rel: 0.6 });
      bellAt(t + 0.8, 'C7', 0.04);
    },
    defeat: t => {
      arp(t, ['E4', 'D4', 'C4', 'B3'], 0.38, { type: 'triangle', peak: 0.1, a: 0.02, decay: 0.3, sustain: 0.5, dur: 0.34, rel: 0.2 });
      tone(t + 1.52, hz(midi('A3')), { type: 'triangle', peak: 0.1, a: 0.02, decay: 0.8, sustain: 0.4, dur: 1.4, rel: 0.8 });
      tone(t + 1.52, hz(midi('C4')), { type: 'triangle', peak: 0.05, a: 0.05, dur: 1.4, rel: 0.8 });
    },
    levelup: t => { arp(t, ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0.06, { type: 'square', lp: 3500, peak: 0.04, a: 0.003, decay: 0.1, sustain: 0.4, dur: 0.12, rel: 0.12 }); bellAt(t + 0.36, 'C7', 0.04); },
    join: t => { bellAt(t, 'G5'); bellAt(t + 0.18, 'C6'); arp(t + 0.36, ['C5', 'E5', 'G5', 'C6', 'E6'], 0.07, { type: 'triangle', peak: 0.05, a: 0.003, decay: 0.3, sustain: 0, dur: 0.6, rel: 0.3 }); },
    chest: t => { arp(t, ['A4', 'C#5', 'E5', 'A5'], 0.07, { type: 'triangle', peak: 0.08, a: 0.003, decay: 0.2, sustain: 0.2, dur: 0.12, rel: 0.15 }); bellAt(t + 0.28, 'A6', 0.05); },
    fragment: t => { bellAt(t, 'E6', 0.08); bellAt(t + 0.12, 'B6', 0.07); noise(t, { type: 'highpass', f: 7000, peak: 0.04, a: 0.1, dur: 0.5, rel: 0.4 }); },
    rest: t => arp(t, ['F4', 'A4', 'C5', 'F5', 'A5'], 0.13, { type: 'triangle', peak: 0.06, a: 0.004, decay: 0.6, sustain: 0, dur: 1.2, rel: 0.6 }),
    chapter: t => {
      for (const [k, p] of [[1, 0.2], [2.4, 0.07], [3.9, 0.04]]) tone(t, 98 * k, { peak: p, a: 0.004, decay: 1.2 / k, sustain: 0, dur: 2.5, rel: 1 });
      bellAt(t + 0.6, 'G6', 0.04); bellAt(t + 0.85, 'D7', 0.03);
    },
    lighthouse: t => {
      const fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(2400, t + 2.6);
      fl.connect(g); g.connect(sfxBus);
      const stop = env(g, t, { peak: 0.03, a: 2.2, dur: 3, rel: 1.5 });
      for (const n of ['C4', 'G4', 'C5', 'E5', 'G5']) for (const dt of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(midi(n)); o.detune.value = dt; o.connect(fl); o.start(t); o.stop(stop); }
      ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => bellAt(t + 1.6 + i * 0.22, n, 0.06));
    }
  };
  function sfx(name, t, opts) { SFX[name]?.(t, opts); }

  return { ctx, master, musicBus, sfxBus, voice, sfx, names: Object.keys(SFX) };
}

// ---------- 播放器 ----------
// mode：'all' 音樂與音效、'sfx' 只有音效、'off' 關閉。偏好存在 localStorage 的 hd2d-sound。
const MODES = ['all', 'sfx', 'off'];
function readMode() { try { const v = localStorage.getItem('hd2d-sound'); return MODES.includes(v) ? v : 'all'; } catch { return 'all'; } }
function saveMode(v) { try { localStorage.setItem('hd2d-sound', v); } catch { /* 無法儲存時仍可遊玩 */ } }

export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let syn = null, mode = readMode(), want = null, cur = null, lastText = 0;
  const compiled = {};

  function init() {
    if (syn || !AC) return;
    try { syn = createSynth(new AC({ latencyHint: 'interactive' })); }
    catch (err) { console.warn('[星燈港] 無法啟用聲音', err); return; }
    applyMode();
    setInterval(tick, 50);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) syn.ctx.suspend();
      else if (mode !== 'off') syn.ctx.resume();
    });
  }
  function applyMode() {
    if (!syn) return;
    if (mode === 'off') syn.ctx.suspend();
    else if (!document.hidden) syn.ctx.resume();
    if (mode !== 'all' && cur) { stop(cur, 0.05); cur = null; }
    if (mode === 'all') music(want);
  }

  // 排程：每 50 毫秒把接下來 0.3 秒內的音排進去
  function tick() {
    if (!cur || syn.ctx.state !== 'running') return;
    const now = syn.ctx.currentTime, def = cur.def;
    if (cur.next < now) cur.next = now + 0.03; // 卡頓或切回分頁時直接跳過，不一次補一大串音
    while (cur.next < now + 0.3) {
      for (const e of cur.steps[cur.i]) syn.voice(e, cur.next, def.step, cur.out);
      cur.next += def.step; cur.i = (cur.i + 1) % cur.steps.length;
    }
  }
  function stop(tr, fade) {
    const g = tr.out.gain, t = syn.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, fade);
    setTimeout(() => tr.out.disconnect(), fade * 8000 + 500);
  }
  // 切換配樂；同一首重複呼叫不會重來。fade 是舊曲淡出的時間常數（秒）。
  function music(name, fade = 0.4) {
    want = name || null;
    if (!syn || mode !== 'all' || (cur?.name ?? null) === want) return;
    if (cur) stop(cur, fade);
    cur = null;
    if (!want) return;
    const def = TRACKS[want], t = syn.ctx.currentTime, out = syn.ctx.createGain();
    out.gain.value = 0.0001; out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(def.gain, t + (fade < 0.2 ? 0.05 : 1.2));
    out.connect(syn.musicBus);
    cur = { name: want, def, steps: compiled[want] ||= compileTrack(def), i: 0, next: t + 0.06, out };
  }

  return {
    // 在使用者的按鍵或點擊裡呼叫，瀏覽器才允許發聲
    unlock() {
      init();
      if (syn && mode !== 'off' && syn.ctx.state !== 'running' && !document.hidden) syn.ctx.resume();
    },
    music,
    sfx(name, opts = {}) {
      if (!syn || mode === 'off') return;
      const t = syn.ctx.currentTime;
      if (name === 'text') { if (t - lastText < 0.055) return; lastText = t; }
      syn.sfx(name, t + 0.005 + (opts.delay || 0), opts);
    },
    get mode() { return mode; },
    setMode(v) { if (!MODES.includes(v)) return; mode = v; saveMode(v); applyMode(); },
    state: () => ({ mode, ctx: syn ? syn.ctx.state : 'none', track: cur?.name ?? null, want })
  };
}

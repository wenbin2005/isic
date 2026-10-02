/* 門檻採保守初始值；依可見前景實測，不以手機型號直接判斷。 */
export function createPerformanceGate(initialQuality, force3D = false) {
  let quality = initialQuality, warmUntil = 0, samples = [], slowWindows = 0;
  return {
    reset(now, newQuality = quality) { quality = newQuality; warmUntil = now + 4000; samples = []; slowWindows = 0; },
    sample({ fps, now, visible = true }) {
      if (force3D || !visible || !Number.isFinite(fps) || fps <= 0) { samples = []; slowWindows = 0; return null; }
      if (now < warmUntil) return null;
      samples.push(fps);
      if (samples.length < 3) return null;
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      samples = [];
      if (average >= (quality === 'high' ? 24 : 20)) { slowWindows = 0; return null; }
      slowWindows++;
      if (slowWindows < 2) return null;
      slowWindows = 0;
      if (quality === 'high') { quality = 'balanced'; warmUntil = now + 4000; return 'balanced'; }
      return 'classic';
    }
  };
}

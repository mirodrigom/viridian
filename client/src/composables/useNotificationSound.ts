/**
 * Plays a short attention ping when a tool needs manual approval.
 * Distinct from the completion chime — single descending note (E5 → C5).
 */
export function playToolApprovalSound() {
  try {
    const ctx = new AudioContext();

    // Single gentle ping at A4 (440 Hz) — short and non-intrusive
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 440;

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not available — silently ignore
  }
}

/**
 * Plays a friendly chime notification using the Web Audio API.
 * No audio files needed — generates a pleasant two-tone chime programmatically.
 */
export function playResponseCompleteSound() {
  try {
    const ctx = new AudioContext();

    // Two-note ascending chime (C5 → E5)
    const notes = [523.25, 659.25];
    const startTimes = [0, 0.12];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Gentle volume envelope
      gain.gain.setValueAtTime(0, ctx.currentTime + startTimes[i]!);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + startTimes[i]! + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTimes[i]! + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startTimes[i]!);
      osc.stop(ctx.currentTime + startTimes[i]! + 0.45);
    });

    // Close context after sounds finish
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Audio not available (e.g. no user interaction yet) — silently ignore
  }
}

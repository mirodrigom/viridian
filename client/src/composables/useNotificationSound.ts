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

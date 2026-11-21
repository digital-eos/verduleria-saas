/**
 * Bip de caja al escanear (Web Audio, sin archivos de sonido).
 * "ok" = un bip agudo corto; "error" = dos bips graves (código desconocido o inválido).
 * El navegador solo deja sonar audio después de un toque/tecla del usuario: antes de eso no suena nada.
 */
let ctx: AudioContext | null = null;

function tone(ac: AudioContext, freq: number, start: number, dur: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  // envolvente corta para que no "clickee"
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function beep(kind: "ok" | "error" = "ok") {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    if (kind === "ok") tone(ctx, 2200, t, 0.09);
    else {
      tone(ctx, 440, t, 0.12);
      tone(ctx, 330, t + 0.17, 0.16);
    }
    navigator.vibrate?.(kind === "ok" ? 40 : [60, 60, 60]);
  } catch {
    // sin audio: no pasa nada
  }
}

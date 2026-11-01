import { VoiceReading } from '../../core/audio/voice-meter';
import { TutorState } from '../../core/models/tutor.models';

/**
 * La línea de voz de Nimbo, como matemática pura (sin DOM).
 *
 * Una "onda" es una lista de POINTS valores entre -1 y 1 (altura de cada punto de
 * la línea). `targetWave` decide la forma según el estado y la voz; `smoothWave` la
 * suaviza entre frames; `wavePath` la convierte en un trazado SVG.
 */
export const POINTS = 72;

/** Ventana de Hann: 0 en los bordes y 1 al centro, para que la línea nazca y muera plana. */
const WINDOW = Array.from(
  { length: POINTS },
  (_, i) => Math.sin((Math.PI * i) / (POINTS - 1)) ** 2,
);

export function targetWave(state: TutorState, voice: VoiceReading | null, t: number): number[] {
  switch (state) {
    case 'speaking':
      return voice ? fromAudio(voice, 1) : simulatedSpeech(t);
    case 'listening':
      // Tu voz, un poco más chica (la protagonista sigue siendo la de Nimbo).
      return voice && voice.level > 0.02 ? fromAudio(voice, 0.65) : breathing(t, 0.1);
    case 'thinking':
      return travellingPulse(t);
    default:
      return breathing(t, 0.06);
  }
}

/** La forma de onda real: se reduce a POINTS puntos y su altura sigue al volumen. */
function fromAudio({ waveform, level }: VoiceReading, scale: number): number[] {
  const bucket = Math.max(1, Math.floor(waveform.length / POINTS));
  const raw = WINDOW.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < bucket; j++) sum += waveform[i * bucket + j] ?? 0;
    return sum / bucket;
  });
  const peak = Math.max(...raw.map(Math.abs), 1e-6);
  // Se normaliza la FORMA y la altura la pone el volumen: así una voz suave
  // también se ve, y un grito no se sale de la pantalla.
  return raw.map((v, i) => (v / peak) * level * scale * WINDOW[i]);
}

/** Si el navegador no activó el audio, igual se ve "hablando". */
function simulatedSpeech(t: number): number[] {
  const energy = 0.35 + 0.35 * Math.abs(Math.sin(t * 4.3));
  return WINDOW.map((w, i) => {
    const x = i / (POINTS - 1);
    return (Math.sin(x * 38 + t * 22) * 0.6 + Math.sin(x * 17 - t * 13) * 0.4) * energy * w;
  });
}

/** En reposo: una ondita tranquila, como respirando. */
function breathing(t: number, amplitude: number): number[] {
  return WINDOW.map((w, i) => amplitude * Math.sin((i / (POINTS - 1)) * Math.PI * 3 + t * 1.6) * w);
}

/** Pensando: un pulso que recorre la línea de izquierda a derecha. */
function travellingPulse(t: number): number[] {
  const center = ((t * 0.7) % 1.4) - 0.2;
  return WINDOW.map((_, i) => {
    const d = i / (POINTS - 1) - center;
    return 0.55 * Math.sin(d * 55) * Math.exp(-((d / 0.07) ** 2));
  });
}

/** Acerca la onda actual a la objetivo: sube rápido y baja más lento (se ve fluida, no nerviosa). */
export function smoothWave(current: number[], target: number[]): number[] {
  return target.map((to, i) => {
    const from = current[i] ?? 0;
    const k = Math.abs(to) > Math.abs(from) ? 0.55 : 0.25;
    return from + (to - from) * k;
  });
}

/**
 * Convierte la onda en un trazado SVG suave (Catmull-Rom → curvas de Bézier),
 * entre `x0` y `x0 + width`, centrado en `cy`, con altura máxima `amplitude`.
 */
export function wavePath(
  wave: number[],
  x0: number,
  width: number,
  cy: number,
  amplitude: number,
): string {
  const pts = wave.map((v, i) => [x0 + (width * i) / (wave.length - 1), cy - v * amplitude]);
  const f = (n: number) => n.toFixed(1);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

import { TutorState } from '../../core/models/tutor.models';
import { VoiceReading } from '../../core/audio/voice-meter';

/**
 * La boquita flotante de Nimbo, como matemática pura (sin DOM): dado el estado y
 * la voz, calcula la pose; dada la pose, calcula el trazado SVG.
 */
export interface MouthPose {
  /** 0 = cerrada, 1 = abierta del todo. */
  open: number;
  /** -1 = redonda ("oo"), 0 = normal, 1 = ancha ("ee"). */
  wide: number;
  /** Curvatura de sonrisa en px (0 = recta). */
  smile: number;
  /** Inclinación en grados (al "pensar" la boca se ladea). */
  tilt: number;
  /** Desplazamiento horizontal en px (al pensar se va a un costado: "mmm…"). */
  shiftX: number;
}

export const IDLE_POSE: MouthPose = { open: 0, wide: 0.2, smile: 7, tilt: 0, shiftX: 0 };

/** Pose objetivo para este frame. `t` en segundos, para los movimientos automáticos. */
export function targetPose(state: TutorState, voice: VoiceReading | null, t: number): MouthPose {
  switch (state) {
    case 'speaking': {
      // Sin medidor (p. ej. el navegador no activó el audio), se simula el habla.
      const reading = voice ?? {
        level: 0.45 + 0.35 * Math.sin(t * 17) * Math.abs(Math.sin(t * 4.3)),
        brightness: 0.5 + 0.3 * Math.sin(t * 7),
      };
      return {
        open: 0.04 + 0.92 * reading.level,
        wide: (reading.brightness - 0.5) * 1.6,
        smile: 3,
        tilt: 0,
        shiftX: 0,
      };
    }
    case 'listening': {
      // Atenta: una "o" chiquita que se abre un poco con tu voz, como asintiendo.
      const level = voice?.level ?? 0;
      return { open: 0.1 + 0.18 * level, wide: -0.3, smile: 4, tilt: 0, shiftX: 0 };
    }
    case 'thinking':
      return { open: 0.06, wide: -0.6, smile: 1, tilt: -9 + 2 * Math.sin(t * 2), shiftX: 7 };
    default:
      return IDLE_POSE;
  }
}

/**
 * Acerca la pose actual a la objetivo. La boca abre rápido y cierra más lento:
 * así se ven las sílabas y no tiembla con cada variación mínima del volumen.
 */
export function smoothPose(current: MouthPose, target: MouthPose): MouthPose {
  const ease = (from: number, to: number, k: number) => from + (to - from) * k;
  return {
    open: ease(current.open, target.open, target.open > current.open ? 0.5 : 0.22),
    wide: ease(current.wide, target.wide, 0.2),
    smile: ease(current.smile, target.smile, 0.12),
    tilt: ease(current.tilt, target.tilt, 0.1),
    shiftX: ease(current.shiftX, target.shiftX, 0.1),
  };
}

export interface MouthGeometry {
  /** Contorno de la boca (centrado en 0,0): se rellena por dentro y se traza como labios. */
  outline: string;
  /** Centro y radios de la lengua (solo se ve con la boca abierta). */
  tongue: { cy: number; rx: number; ry: number };
  /** Borde superior de la abertura, para ubicar los dientes. */
  top: number;
  halfWidth: number;
}

export function mouthGeometry(pose: MouthPose): MouthGeometry {
  const halfWidth = 16 + 5 * pose.wide - 2 * pose.open;
  const corner = -pose.smile * 0.35; // comisuras un poco arriba = sonrisa
  const upper = 0.8 * pose.smile - 9 * pose.open; // el labio de arriba sube poco
  const lower = pose.smile + 20 * pose.open; // la "mandíbula" baja más
  const c = halfWidth * 0.5;
  const f = (n: number) => n.toFixed(2);
  const outline =
    `M ${f(-halfWidth)} ${f(corner)} ` +
    `C ${f(-c)} ${f(upper)} ${f(c)} ${f(upper)} ${f(halfWidth)} ${f(corner)} ` +
    `C ${f(c)} ${f(lower)} ${f(-c)} ${f(lower)} ${f(-halfWidth)} ${f(corner)} Z`;
  // En una curva cúbica simétrica, el punto medio queda a 3/4 del punto de control.
  const top = corner + 0.75 * (upper - corner);
  const bottom = corner + 0.75 * (lower - corner);
  return {
    outline,
    top,
    halfWidth,
    tongue: { cy: bottom - 1, rx: halfWidth * 0.5, ry: Math.max(0, 7 * pose.open) },
  };
}

/* ─────────────────────────────────────────────────────────
   machado.ts — 색각 시뮬레이션 & Daltonization 보정 행렬.

   원본: vcd-display/vcd-app/js/color-test.js (simulateMatrix /
   correctionMatrix / lerpMatrix).

   상수(MACHADO_*, IDENTITY_3)는 src/constants/machado.ts에.
   여기는 그 행렬을 이용한 *연산*만 담음.

   Daltonization 수식:
     c_sim         = M_sim · c_orig                (severity-lerped Machado)
     c_corrected   = c_orig + (c_orig − c_sim)
                   = (2I − M_sim) · c_orig

   즉 correction_lut.matrix = 2I − M_sim 을 셰이더에 그대로 곱하면 끝.
   ───────────────────────────────────────────────────────── */
import {
  IDENTITY_3,
  MACHADO,
  type RGBMatrix3,
} from '@/constants/machado';
import type { ColorVisionType } from '@/types/profile';

/** Machado 키와 vcd-display의 ColorVisionType을 매핑. */
const MACHADO_KEY: Record<string, keyof typeof MACHADO> = {
  protanomaly: 'protan',
  deuteranomaly: 'deutan',
  tritanomaly: 'tritan',
  // 원본 color-test.js의 fallback: mild_anomaly / achromatopsia 도 deutan으로.
  mild_anomaly: 'deutan',
  achromatopsia: 'deutan',
};

export interface CorrectionLUT {
  matrix: RGBMatrix3;
  type: 'identity' | 'daltonize';
  severity: number;
  machadoKey?: keyof typeof MACHADO;
}

/**
 * 색각 결함 시뮬레이션 행렬.
 * normal이거나 severity≤0이면 항등 행렬.
 * 그 외에는 항등 → MACHADO[type] 선형보간 (severity가 보간 계수).
 */
export function simulateMatrix(type: ColorVisionType | string, severity: number): RGBMatrix3 {
  if (type === 'normal' || severity <= 0) return copyMatrix(IDENTITY_3);
  const key = MACHADO_KEY[type];
  if (!key) return copyMatrix(IDENTITY_3);
  return lerpMatrix(IDENTITY_3, MACHADO[key], severity);
}

/**
 * Daltonization 보정 행렬 = 2I − simulateMatrix(type, severity).
 * M3 fragment shader의 u_colorMatrix uniform에 그대로 주입.
 */
export function correctionMatrix(
  type: ColorVisionType | string,
  severity: number,
): CorrectionLUT {
  if (type === 'normal' || severity <= 0) {
    return { matrix: copyMatrix(IDENTITY_3), type: 'identity', severity: 0 };
  }
  const machadoKey = MACHADO_KEY[type];
  if (!machadoKey) {
    return { matrix: copyMatrix(IDENTITY_3), type: 'identity', severity: 0 };
  }
  const M = lerpMatrix(IDENTITY_3, MACHADO[machadoKey], severity);
  // 2I − M
  const C: RGBMatrix3 = [
    [2 - M[0][0], -M[0][1], -M[0][2]],
    [-M[1][0], 2 - M[1][1], -M[1][2]],
    [-M[2][0], -M[2][1], 2 - M[2][2]],
  ];
  return {
    matrix: C,
    type: 'daltonize',
    severity: round2(severity),
    machadoKey,
  };
}

// ── Matrix helpers ─────────────────────────────────────
export function lerpMatrix(A: RGBMatrix3, B: RGBMatrix3, t: number): RGBMatrix3 {
  return [
    [A[0][0] * (1 - t) + B[0][0] * t, A[0][1] * (1 - t) + B[0][1] * t, A[0][2] * (1 - t) + B[0][2] * t],
    [A[1][0] * (1 - t) + B[1][0] * t, A[1][1] * (1 - t) + B[1][1] * t, A[1][2] * (1 - t) + B[1][2] * t],
    [A[2][0] * (1 - t) + B[2][0] * t, A[2][1] * (1 - t) + B[2][1] * t, A[2][2] * (1 - t) + B[2][2] * t],
  ];
}

function copyMatrix(M: RGBMatrix3): RGBMatrix3 {
  return [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]],
  ];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

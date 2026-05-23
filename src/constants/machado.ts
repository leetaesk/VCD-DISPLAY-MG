/**
 * Machado 2009 색각 결함 시뮬레이션 행렬.
 *
 * Reference:
 *   Machado GM, Oliveira MM, Fernandes LAF.
 *   "A Physiologically-Based Model for Simulation of Color Vision Deficiency."
 *   IEEE Trans. Visualization & Computer Graphics 15(6), 2009.
 *
 * 100% severity (완전 dichromacy) RGB → RGB 행렬.
 * severity < 1 은 항등 행렬과 lerp으로 도출.
 *
 * Daltonization 보정 행렬은 이 시뮬레이션 행렬에서 역 도출 후
 * M3 (color-correct.frag)의 uniform으로 주입.
 */
export type RGBMatrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export const IDENTITY_3: RGBMatrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const MACHADO_PROTAN: RGBMatrix3 = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];

export const MACHADO_DEUTAN: RGBMatrix3 = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

export const MACHADO_TRITAN: RGBMatrix3 = [
  [1.255528, -0.076749, -0.178779],
  [-0.078411, 0.930809, 0.147602],
  [0.004733, 0.691367, 0.3039],
];

export const MACHADO = {
  protan: MACHADO_PROTAN,
  deutan: MACHADO_DEUTAN,
  tritan: MACHADO_TRITAN,
} as const;

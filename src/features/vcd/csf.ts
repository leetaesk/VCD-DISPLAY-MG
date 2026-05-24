/* ─────────────────────────────────────────────────────────
   csf.ts — CSF 도메인 로직 (staircase, classification).
   순수 함수로만 구성 — DOM 무관.
   원본: vcd-display/vcd-app/js/csf-test.js의 알고리즘 부분.
   ───────────────────────────────────────────────────────── */
import { CSF_FREQUENCIES_CPD } from '@/constants/vision';
import type { CSFClassification } from '@/types/profile';

export const INITIAL_CONTRAST = 0.5;
export const MIN_CONTRAST = 0.002;
export const MAX_CONTRAST = 1.0;
export const STEP_COARSE = 2.0;
export const STEP_FINE = Math.SQRT2;
export const REVERSALS_NEEDED = 6;
export const REVERSALS_TO_AVG = 4;
export const DOWN_RUN_LENGTH = 3;
// staircase가 6 reversal을 채우려면 최소 ~24 trial 필요 (3-down/1-up + √2 fine step).
// 너무 낮추면 모든 주파수가 threshold 없이 강제 종료되어 CSF 곡선이 비게 됨.
export const MAX_TRIALS_PER_FREQ = 25;
export const Z_FLAG_THRESHOLD = -2.5;

export const NORMATIVE_LOG_MEAN: Record<number, number> = {
  0.5: 1.7,
  1: 2.0,
  2: 2.2,
  4: 2.3,
  8: 2.0,
  12: 1.7,
  16: 1.4,
};
export const NORMATIVE_LOG_STD: Record<number, number> = {
  0.5: 0.15,
  1: 0.14,
  2: 0.13,
  4: 0.12,
  8: 0.13,
  12: 0.15,
  16: 0.16,
};

export interface Staircase {
  cpd: number;
  screenLimited: boolean;
  contrast: number;
  lastDirection: 0 | -1 | 1;
  correctStreak: number;
  reversals: number[];
  trials: { contrast: number; correct: boolean }[];
  finalized: boolean;
  threshold: number | null;
  capped: boolean;
}

export function freshStaircase(cpd: number, screenLimited: boolean): Staircase {
  return {
    cpd,
    screenLimited,
    contrast: INITIAL_CONTRAST,
    lastDirection: 0,
    correctStreak: 0,
    reversals: [],
    trials: [],
    finalized: screenLimited,
    threshold: null,
    capped: false,
  };
}

/** 2.5 px/cycle 미만이면 screen-limited. */
export function pxPerCycle(cpd: number, distanceCm: number, ppi: number): number {
  const pxPerDeg = ((distanceCm * 10 * Math.PI) / 180) * (ppi / 25.4);
  return pxPerDeg / cpd;
}

/**
 * 한 trial 결과(correct) → staircase 갱신. 새로운 staircase 객체 반환.
 */
export function staircaseStep(sc: Staircase, correct: boolean): Staircase {
  const next: Staircase = {
    ...sc,
    trials: [...sc.trials, { contrast: sc.contrast, correct }],
    reversals: [...sc.reversals],
  };
  const step = next.reversals.length < 2 ? STEP_COARSE : STEP_FINE;

  if (correct) {
    next.correctStreak = sc.correctStreak + 1;
    if (next.correctStreak >= DOWN_RUN_LENGTH) {
      if (sc.lastDirection === +1) next.reversals.push(sc.contrast);
      next.lastDirection = -1;
      next.contrast = clamp(sc.contrast / step, MIN_CONTRAST, MAX_CONTRAST);
      next.correctStreak = 0;
    }
  } else {
    if (sc.lastDirection === -1) next.reversals.push(sc.contrast);
    next.lastDirection = +1;
    next.contrast = clamp(sc.contrast * step, MIN_CONTRAST, MAX_CONTRAST);
    next.correctStreak = 0;
  }

  if (next.reversals.length >= REVERSALS_NEEDED) {
    const last = next.reversals.slice(-REVERSALS_TO_AVG);
    const logMean = last.reduce((s, c) => s + Math.log10(c), 0) / last.length;
    next.threshold = Math.pow(10, logMean);
    next.finalized = true;
    return next;
  }
  if (next.trials.length >= MAX_TRIALS_PER_FREQ) {
    if (next.reversals.length >= 2) {
      const last = next.reversals.slice(-Math.min(REVERSALS_TO_AVG, next.reversals.length));
      const logMean = last.reduce((s, c) => s + Math.log10(c), 0) / last.length;
      next.threshold = Math.pow(10, logMean);
      next.capped = true;
    }
    next.finalized = true;
  }
  return next;
}

// ── Aggregate / classify ──────────────────────────────
export interface EyeResult {
  freqs: number[];
  thresholds: (number | null)[];
  sensitivities: (number | null)[];
  reversals_used: number[][];
  screen_limited: boolean[];
  confidence: number;
  classification: ClassificationResult | null;
  partial: boolean;
}

export interface ClassificationResult {
  category: CSFClassification | 'no_data';
  label: string;
  clinicalNote: string;
  flagged: boolean;
}

export function aggregateEyeResult(
  staircases: Record<number, Staircase>,
  partial: boolean,
): EyeResult {
  const freqs = [...CSF_FREQUENCIES_CPD];
  const thresholds = freqs.map((f) => staircases[f]?.threshold ?? null);
  const sensitivities = thresholds.map((t) => (t === null ? null : 1 / t));

  const usable = freqs.filter((f) => staircases[f]?.finalized && !staircases[f]?.screenLimited);
  let conf = 0.45 + 0.07 * usable.length;
  let varSum = 0;
  let varN = 0;
  for (const f of usable) {
    const last = staircases[f].reversals.slice(-REVERSALS_TO_AVG);
    if (last.length >= 2) {
      const logs = last.map((c) => Math.log10(c));
      const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
      const v = logs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / logs.length;
      varSum += v;
      varN++;
    }
  }
  if (varN > 0) {
    conf -= Math.min(0.25, (varSum / varN) * 1.5);
  }
  conf = clamp(conf, 0.35, 0.95);

  return {
    freqs,
    thresholds,
    sensitivities,
    reversals_used: freqs.map((f) => staircases[f]?.reversals.slice() ?? []),
    screen_limited: freqs.map((f) => staircases[f]?.screenLimited ?? false),
    confidence: Math.round(conf * 100) / 100,
    classification: classify(freqs, sensitivities),
    partial,
  };
}

export function classify(
  freqs: number[],
  sensitivities: (number | null)[],
): ClassificationResult {
  const zByFreq: Record<number, number> = {};
  let measured = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const s = sensitivities[i];
    if (s === null) continue;
    measured++;
    zByFreq[f] = (Math.log10(s) - NORMATIVE_LOG_MEAN[f]) / NORMATIVE_LOG_STD[f];
  }
  if (measured === 0) {
    return {
      category: 'no_data',
      label: '측정 데이터 부족',
      clinicalNote: '재검사가 필요합니다.',
      flagged: false,
    };
  }
  const lowFreqs = Object.entries(zByFreq)
    .filter(([, z]) => z < Z_FLAG_THRESHOLD)
    .map(([f]) => Number(f));
  const lowCount = lowFreqs.filter((f) => f < 2).length;
  const midCount = lowFreqs.filter((f) => f >= 2 && f < 8).length;
  const highCount = lowFreqs.filter((f) => f >= 8).length;

  if (lowFreqs.length <= 1) {
    return {
      category: 'normal',
      label: '정상 범위',
      clinicalNote: '연령 평균 곡선과 일치합니다.',
      flagged: false,
    };
  }
  if (lowFreqs.length >= 5) {
    return {
      category: 'global',
      label: '전반적 저하',
      clinicalNote: '전체 주파수에서 민감도가 낮습니다 — 백내장·각막 혼탁 가능성. 안과 진료를 권장합니다.',
      flagged: true,
    };
  }
  if (highCount >= 2 && lowCount === 0 && midCount <= 1) {
    return {
      category: 'high_freq',
      label: '고주파 저하',
      clinicalNote: '고공간주파수 민감도가 낮습니다 — 노안 또는 굴절 보정 부족 가능성. 굴절 검사를 권장합니다.',
      flagged: false,
    };
  }
  if (midCount >= 2 && highCount === 0) {
    return {
      category: 'mid_freq',
      label: '중주파 저하',
      clinicalNote: '중공간주파수 민감도가 낮습니다 — 황반 이상 가능성. 안과 검진을 권장합니다.',
      flagged: true,
    };
  }
  return {
    category: 'mixed',
    label: '복합 패턴',
    clinicalNote: '분류가 불분명합니다. 재검사 또는 안과 상담을 권장합니다.',
    flagged: false,
  };
}

export function severityRank(cat: string | null | undefined): number {
  return (
    ({ normal: 0, high_freq: 1, mixed: 2, mid_freq: 3, global: 4, no_data: 0 } as Record<
      string,
      number
    >)[cat ?? 'normal'] ?? 0
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

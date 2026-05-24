/* ─────────────────────────────────────────────────────────
   csf.ts — CSF 도메인 로직.

   알고리즘: 단계적 하강법 (descending method of limits).
   - CONTRAST_LEVELS 위→아래로 한 단계씩 내려가며 자극 제시.
   - 정답: 다음 단계로 진행, 오답: 같은 단계 유지 (한 번 더 기회).
   - 2회 연속 오답 → 즉시 종료, threshold = 마지막 정답 contrast.
   - 최저 단계까지 모두 정답 → floor 도달, threshold = MIN_CONTRAST.

   원본은 3-down/1-up adaptive였으나 trial 수가 너무 많아 사용자
   체감이 무한 루프 같다는 피드백으로 단순한 하강법으로 교체.
   ───────────────────────────────────────────────────────── */
import { CSF_FREQUENCIES_CPD } from '@/constants/vision';
import type { CSFClassification } from '@/types/profile';

// √2 간격으로 0.5 → 0.002까지 17단계
export const CONTRAST_LEVELS: number[] = [
  0.5, 0.354, 0.25, 0.177, 0.125, 0.088, 0.0625, 0.044, 0.0312, 0.0221,
  0.0156, 0.011, 0.0078, 0.0055, 0.0039, 0.0028, 0.002,
];
export const MIN_CONTRAST = CONTRAST_LEVELS[CONTRAST_LEVELS.length - 1];
export const MAX_CONTRAST = CONTRAST_LEVELS[0];
export const WRONG_STREAK_TO_FINALIZE = 2;
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
  contrastIdx: number;
  wrongStreak: number;
  lastCorrectContrast: number | null;
  trials: { contrast: number; correct: boolean }[];
  finalized: boolean;
  threshold: number | null;
  /** floor 도달(맨 아래 단계 통과)로 capped됨 — 사용자 sensitivity가 측정 floor 이하 */
  capped: boolean;
}

export function freshStaircase(cpd: number, screenLimited: boolean): Staircase {
  return {
    cpd,
    screenLimited,
    contrast: CONTRAST_LEVELS[0],
    contrastIdx: 0,
    wrongStreak: 0,
    lastCorrectContrast: null,
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
  };

  if (correct) {
    next.lastCorrectContrast = sc.contrast;
    next.wrongStreak = 0;
    next.contrastIdx = sc.contrastIdx + 1;
    // 모든 단계 통과 → floor 도달, 사용자 threshold가 측정 floor 이하
    if (next.contrastIdx >= CONTRAST_LEVELS.length) {
      next.threshold = MIN_CONTRAST;
      next.finalized = true;
      next.capped = true;
      return next;
    }
    next.contrast = CONTRAST_LEVELS[next.contrastIdx];
  } else {
    next.wrongStreak = sc.wrongStreak + 1;
    // 2회 연속 오답 → 종료, threshold = 마지막 정답 contrast
    if (next.wrongStreak >= WRONG_STREAK_TO_FINALIZE) {
      next.threshold = next.lastCorrectContrast;
      next.finalized = true;
      return next;
    }
    // 오답이지만 streak < 2 → 같은 단계에서 재시도 (contrast 그대로)
  }

  return next;
}

// ── Aggregate / classify ──────────────────────────────
export interface EyeResult {
  freqs: number[];
  thresholds: (number | null)[];
  sensitivities: (number | null)[];
  trials_used: number[];
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

  // 측정 가능한 주파수 수 기반 신뢰도. 단계법은 trial이 적어 분산 기반 평가가
  // 의미 없어서 단순 fraction-of-coverage로 대체.
  const usable = freqs.filter((f) => staircases[f]?.threshold !== null && !staircases[f]?.screenLimited);
  let conf = 0.5 + 0.06 * usable.length;
  conf = clamp(conf, 0.35, 0.95);

  return {
    freqs,
    thresholds,
    sensitivities,
    trials_used: freqs.map((f) => staircases[f]?.trials.length ?? 0),
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

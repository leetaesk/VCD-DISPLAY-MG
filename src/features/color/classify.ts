/* ─────────────────────────────────────────────────────────
   classify.ts — Ishihara 응답 + FM100 오차 → 색각 유형 / severity.
   원본: color-test.js의 computeFinalResult.
   ───────────────────────────────────────────────────────── */
import { correctionMatrix, type CorrectionLUT } from '@/features/color/machado';

import { FM100_NORMAL_THRESHOLD } from './fm100';
import type { Plate } from './ishiharaPlates';

export type ColorVisionTypeExt =
  | 'normal'
  | 'protanomaly'
  | 'deuteranomaly'
  | 'tritanomaly'
  | 'mild_anomaly'
  | 'achromatopsia';

export interface PlateResponse {
  plate: Plate;
  response: string;
  correct: boolean;
}

export interface FinalResult {
  type: ColorVisionTypeExt;
  severity: number;
  confidence: number;
  ishihara_score: {
    total: number;
    correct: number;
    by_type: {
      demo: number | null;
      protan: number | null;
      deutan: number | null;
      tritan: number | null;
    };
  };
  fm100_error: number;
  correction_lut: CorrectionLUT;
  tested_at: string;
}

export function computeFinalResult(
  responses: PlateResponse[],
  fmErr: number,
): FinalResult {
  const buckets: Record<string, [number, number]> = {
    protan: [0, 0],
    deutan: [0, 0],
    tritan: [0, 0],
    demo: [0, 0],
  };
  for (const r of responses) {
    const t = r.plate.type;
    const which = t === 'protan_deutan' ? ['protan', 'deutan'] : [t];
    for (const key of which) {
      if (!buckets[key]) buckets[key] = [0, 0];
      buckets[key][1] += 1;
      if (r.correct) buckets[key][0] += 1;
    }
  }
  const acc = {
    demo: bucketAcc(buckets.demo),
    protan: bucketAcc(buckets.protan),
    deutan: bucketAcc(buckets.deutan),
    tritan: bucketAcc(buckets.tritan),
  };
  const deficient = {
    protan: acc.protan !== null && acc.protan < 0.6,
    deutan: acc.deutan !== null && acc.deutan < 0.6,
    tritan: acc.tritan !== null && acc.tritan < 0.6,
  };
  const demoFailed = acc.demo !== null && acc.demo < 0.5;
  const fmSeverity = clamp((fmErr - FM100_NORMAL_THRESHOLD) / 60, 0, 1);

  let type: ColorVisionTypeExt = 'normal';
  let severity = 0;
  if (demoFailed) {
    type = 'achromatopsia';
    severity = 1;
  } else if (deficient.protan && deficient.deutan) {
    type = 1 - (acc.protan ?? 0) > 1 - (acc.deutan ?? 0) ? 'protanomaly' : 'deuteranomaly';
    severity = Math.max(1 - (acc.protan ?? 0), 1 - (acc.deutan ?? 0)) * 0.7 + fmSeverity * 0.3;
  } else if (deficient.protan) {
    type = 'protanomaly';
    severity = (1 - (acc.protan ?? 0)) * 0.7 + fmSeverity * 0.3;
  } else if (deficient.deutan) {
    type = 'deuteranomaly';
    severity = (1 - (acc.deutan ?? 0)) * 0.7 + fmSeverity * 0.3;
  } else if (deficient.tritan) {
    type = 'tritanomaly';
    severity = (1 - (acc.tritan ?? 0)) * 0.7 + fmSeverity * 0.3;
  } else if (fmSeverity > 0.4) {
    type = 'mild_anomaly';
    severity = fmSeverity;
  }
  severity = clamp(severity, 0, 1);

  let confidence = 0.7;
  const ishiharaFlags = deficient.protan || deficient.deutan || deficient.tritan;
  const fmFlags = fmSeverity > 0.3;
  if (type === 'normal' && !ishiharaFlags && !fmFlags) confidence = 0.9;
  if (ishiharaFlags && fmFlags) confidence = 0.85;
  if (ishiharaFlags !== fmFlags) confidence = 0.65;

  const correction = correctionMatrix(type, severity);

  return {
    type,
    severity: round2(severity),
    confidence: round2(confidence),
    ishihara_score: {
      total: responses.length,
      correct: responses.filter((x) => x.correct).length,
      by_type: acc,
    },
    fm100_error: fmErr,
    correction_lut: correction,
    tested_at: new Date().toISOString(),
  };
}

function bucketAcc([c, t]: [number, number]): number | null {
  return t === 0 ? null : c / t;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

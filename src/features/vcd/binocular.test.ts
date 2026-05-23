import { describe, expect, it } from 'vitest';

import {
  computeWeights,
  HALF_POINT_S,
  MAX_STRENGTH,
  MIN_STRENGTH,
  strengthAt,
} from './binocular';

describe('strengthAt', () => {
  it('t=0은 baseline에 가까움', () => {
    expect(strengthAt(0)).toBeLessThan(MIN_STRENGTH + 0.1);
  });

  it('HALF_POINT_S에서 (min+max)/2 부근', () => {
    expect(strengthAt(HALF_POINT_S)).toBeCloseTo((MIN_STRENGTH + MAX_STRENGTH) / 2, 5);
  });

  it('충분히 큰 t는 MAX에 수렴', () => {
    expect(strengthAt(60 * 60)).toBeGreaterThan(0.95);
  });

  it('음수 / NaN 입력은 0으로 폴백', () => {
    expect(strengthAt(-100)).toBeCloseTo(strengthAt(0), 10);
    expect(strengthAt(NaN)).toBeCloseTo(strengthAt(0), 10);
  });
});

describe('computeWeights', () => {
  it('null gaze는 50/50', () => {
    const w = computeWeights(null);
    expect(w.od).toBe(0.5);
    expect(w.os).toBe(0.5);
  });

  it('가중치 합은 항상 1', () => {
    for (const x of [0, 0.1, 0.5, 0.8, 1]) {
      const w = computeWeights({ x });
      expect(w.od + w.os).toBeCloseTo(1, 10);
    }
  });

  it('gaze 왼쪽(x=0.2) → selfie-flip 후 OD 우세', () => {
    // selfie flip: screenX = 1 - 0.2 = 0.8 (오른쪽) → OD weight ↑
    const w = computeWeights({ x: 0.2 });
    expect(w.od).toBeGreaterThan(w.os);
  });

  it('gaze 중앙 → 정확히 50/50', () => {
    const w = computeWeights({ x: 0.5 });
    expect(w.od).toBeCloseTo(0.5, 10);
    expect(w.os).toBeCloseTo(0.5, 10);
  });
});

import { describe, expect, it } from 'vitest';

import { IDENTITY_3, MACHADO_DEUTAN } from '@/constants/machado';

import { correctionMatrix, lerpMatrix, simulateMatrix } from './machado';

describe('lerpMatrix', () => {
  it('t=0이면 A 그대로', () => {
    const r = lerpMatrix(IDENTITY_3, MACHADO_DEUTAN, 0);
    expect(r).toEqual(IDENTITY_3);
  });

  it('t=1이면 B 그대로', () => {
    const r = lerpMatrix(IDENTITY_3, MACHADO_DEUTAN, 1);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) expect(r[i][j]).toBeCloseTo(MACHADO_DEUTAN[i][j], 10);
  });
});

describe('simulateMatrix', () => {
  it('normal 또는 severity≤0이면 identity', () => {
    expect(simulateMatrix('normal', 0.8)).toEqual(IDENTITY_3);
    expect(simulateMatrix('protanomaly', 0)).toEqual(IDENTITY_3);
  });

  it('알 수 없는 type은 identity', () => {
    expect(simulateMatrix('garbage_type', 0.5)).toEqual(IDENTITY_3);
  });

  it('protanomaly + severity 0.5는 항등과 protan 사이', () => {
    const r = simulateMatrix('protanomaly', 0.5);
    // [0][0]은 identity(1) 과 protan(0.152) 사이 ≈ 0.576
    expect(r[0][0]).toBeGreaterThan(0.152);
    expect(r[0][0]).toBeLessThan(1);
  });
});

describe('correctionMatrix', () => {
  it('normal이면 identity 행렬 반환', () => {
    const c = correctionMatrix('normal', 0);
    expect(c.type).toBe('identity');
    expect(c.matrix).toEqual(IDENTITY_3);
  });

  it('Daltonization은 2I − M_sim', () => {
    const c = correctionMatrix('deuteranomaly', 1);
    expect(c.type).toBe('daltonize');
    // diagonal: 2 - M[i][i]
    expect(c.matrix[0][0]).toBeCloseTo(2 - MACHADO_DEUTAN[0][0], 6);
    expect(c.matrix[1][1]).toBeCloseTo(2 - MACHADO_DEUTAN[1][1], 6);
    expect(c.matrix[2][2]).toBeCloseTo(2 - MACHADO_DEUTAN[2][2], 6);
    // off-diagonal: -M[i][j]
    expect(c.matrix[0][1]).toBeCloseTo(-MACHADO_DEUTAN[0][1], 6);
  });
});

import { describe, expect, it } from 'vitest';

import { generatePSF, refractionToZernike } from './psf';

describe('refractionToZernike', () => {
  it('rx=0이면 모든 계수 0', () => {
    const z = refractionToZernike({ sph: 0, cyl: 0, axis: 0 });
    expect(z.c3).toBeCloseTo(0, 10);
    expect(z.c4).toBeCloseTo(0, 10);
    expect(z.c5).toBeCloseTo(0, 10);
  });

  it('근시(sph 음수)는 c4 양수 (Thibos 부호 컨벤션)', () => {
    const z = refractionToZernike({ sph: -2, cyl: 0, axis: 0 });
    expect(z.c4).toBeGreaterThan(0);
    expect(z.c3).toBeCloseTo(0, 10);
    expect(z.c5).toBeCloseTo(0, 10);
  });

  it('axis 0°에서는 c5만 영향, c3은 0', () => {
    const z = refractionToZernike({ sph: 0, cyl: -1, axis: 0 });
    expect(z.c3).toBeCloseTo(0, 10);
    expect(z.c5).not.toBeCloseTo(0, 5);
  });

  it('null rx도 안전 (모든 계수 0)', () => {
    const z = refractionToZernike(null);
    expect(z.c3).toBeCloseTo(0, 10);
    expect(z.c4).toBeCloseTo(0, 10);
    expect(z.c5).toBeCloseTo(0, 10);
  });
});

describe('generatePSF', () => {
  it('PSF 에너지 합 = 1 (정규화)', () => {
    const { psf } = generatePSF({ sph: -2, cyl: -0.5, axis: 90 }, { N: 32 });
    let sum = 0;
    for (let i = 0; i < psf.length; i++) sum += psf[i];
    expect(sum).toBeCloseTo(1, 6);
  });

  it('rx=0 PSF는 (0,0)에 강하게 집중 (Airy disc)', () => {
    const { psf, N } = generatePSF({ sph: 0, cyl: 0, axis: 0 }, { N: 64 });
    const peakAtCorner = psf[0];
    // peak 픽셀은 평균보다 훨씬 커야
    const mean = 1 / (N * N);
    expect(peakAtCorner).toBeGreaterThan(mean * 100);
  });

  it('큰 defocus는 더 분산된 PSF (peak 강도 ↓)', () => {
    const sharp = generatePSF({ sph: 0, cyl: 0, axis: 0 }, { N: 64 }).psf[0];
    const blurry = generatePSF({ sph: -3, cyl: 0, axis: 0 }, { N: 64 }).psf[0];
    expect(blurry).toBeLessThan(sharp);
  });
});

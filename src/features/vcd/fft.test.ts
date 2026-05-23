import { describe, expect, it } from 'vitest';

import { fft1dInPlace, fft2d } from './fft';

describe('CPU FFT', () => {
  it('1D round-trip (FFT → IFFT)이 원본을 복원', () => {
    const N = 16;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * i) / N);
    const reOrig = Float64Array.from(re);
    const imOrig = Float64Array.from(im);

    fft1dInPlace(re, im, false);
    fft1dInPlace(re, im, true);

    for (let i = 0; i < N; i++) {
      expect(re[i]).toBeCloseTo(reOrig[i], 10);
      expect(im[i]).toBeCloseTo(imOrig[i], 10);
    }
  });

  it('2의 거듭제곱 아닌 N은 throw', () => {
    expect(() => fft1dInPlace(new Float64Array(7), new Float64Array(7), false)).toThrow();
  });

  it('Delta impulse → 주파수 영역에서 모두 1', () => {
    const N = 8;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re[0] = 1;
    fft1dInPlace(re, im, false);
    for (let i = 0; i < N; i++) {
      expect(re[i]).toBeCloseTo(1, 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it('2D round-trip도 원본 복원', () => {
    const N = 8;
    const re = new Float64Array(N * N);
    const im = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) re[i] = Math.sin(i * 0.7);
    const reOrig = Float64Array.from(re);

    fft2d(re, im, N, false);
    fft2d(re, im, N, true);

    for (let i = 0; i < N * N; i++) {
      expect(re[i]).toBeCloseTo(reOrig[i], 9);
    }
  });
});

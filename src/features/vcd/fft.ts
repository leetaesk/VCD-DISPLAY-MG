/* ─────────────────────────────────────────────────────────
   fft.ts — CPU Cooley-Tukey radix-2 FFT (iterative).

   원본: vcd-display/vcd-app/js/vcd-shader.js의 cpu.fft1d / cpu.fft2d.

   이 모듈은 GPU FFT의 ground truth 역할.
   GPU와 CPU가 같은 입력에 대해 다른 결과를 내면 GPU 쪽이 잘못된 것 —
   셰이더를 고치지 테스트를 고치지 않음.

   사인 컨벤션:
     forward = exp(-2πi · kn / N)   (inverse=false → sign=-1)
     inverse = exp(+2πi · kn / N)   (inverse=true → sign=+1)
   ───────────────────────────────────────────────────────── */

/**
 * 1D FFT in-place. N은 반드시 2의 거듭제곱.
 * inverse=true이면 1/N 스케일까지 적용해 IFFT 완성.
 */
export function fft1dInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const N = re.length;
  if ((N & (N - 1)) !== 0) {
    throw new Error(`fft1d: N must be power of 2, got ${N}`);
  }
  const sign = inverse ? +1 : -1;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  // Iterative butterflies
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const ang = (sign * 2 * Math.PI) / len;
    const wRe0 = Math.cos(ang);
    const wIm0 = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half];
        const bIm = im[i + k + half];
        // t = w * b
        const tRe = wRe * bRe - wIm * bIm;
        const tIm = wRe * bIm + wIm * bRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + half] = aRe - tRe;
        im[i + k + half] = aIm - tIm;
        // advance twiddle factor
        const nwRe = wRe * wRe0 - wIm * wIm0;
        const nwIm = wRe * wIm0 + wIm * wRe0;
        wRe = nwRe;
        wIm = nwIm;
      }
    }
  }

  if (inverse) {
    const inv = 1 / N;
    for (let i = 0; i < N; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

/**
 * 2D FFT in-place (row-major, N×N).
 * 행 방향 FFT → 열 방향 FFT (separable).
 */
export function fft2d(re: Float64Array, im: Float64Array, N: number, inverse: boolean): void {
  // Row-wise
  const rowRe = new Float64Array(N);
  const rowIm = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      rowRe[x] = re[y * N + x];
      rowIm[x] = im[y * N + x];
    }
    fft1dInPlace(rowRe, rowIm, inverse);
    for (let x = 0; x < N; x++) {
      re[y * N + x] = rowRe[x];
      im[y * N + x] = rowIm[x];
    }
  }
  // Column-wise
  const colRe = new Float64Array(N);
  const colIm = new Float64Array(N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      colRe[y] = re[y * N + x];
      colIm[y] = im[y * N + x];
    }
    fft1dInPlace(colRe, colIm, inverse);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = colRe[y];
      im[y * N + x] = colIm[y];
    }
  }
}

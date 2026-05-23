/* ─────────────────────────────────────────────────────────
   psf.ts — M1 PSF generator (CPU).

   원본: vcd-display/vcd-app/js/vcd-pipeline.js.

   세 단계가 의도적으로 분리되어 있어 각각 단위 테스트 가능:

     refractionToZernike(rx, pupilRmm)
       → { c3, c4, c5 } (OSA μm)
     computeWavefront(zernike, N, pupilRpx)
       → { wavefront, mask } (N×N grid)
     wavefrontToPSF(wavefront, mask, N, λ)
       → Float32Array(N*N) (정규화된 intensity PSF)

   generatePSF(rx, opts)이 셋을 연결한 편의 래퍼.

   Phase 1 범위:
     · Z2~Z5만 (defocus + 두 난시 항)
     · Photopic λ = 555 nm
     · 기본 동공 3 mm (mesopic indoor)
     · CPU 구현. GPU psf-gen 셰이더는 보류.

   PSF 컨벤션:
     반환 PSF는 image space에서 peak가 (0,0) 코너에 wrap-around 형태.
     이게 M4 Wiener가 기대하는 형식 — H = FFT(PSF)가 공간 이동을 안 만듦.
     화면에 peak를 가운데로 *표시*하려면 fftshift()를 적용.
   ───────────────────────────────────────────────────────── */
import { fft2d } from './fft';

// ── Constants ───────────────────────────────────────────
export const WAVELENGTH_MICRON = 0.555; // photopic peak luminosity
export const DEFAULT_PUPIL_MM = 3.0;
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

/** OSA single-index (j = (n(n+2) + m) / 2). Phase 1에서 쓰는 셋. */
export const OSA_J = {
  OBLIQUE_AST: 3,
  DEFOCUS: 4,
  VERTICAL_AST: 5,
} as const;

// ── Types ──────────────────────────────────────────────
export interface RefractionRx {
  sph: number;
  cyl: number;
  axis: number; // degrees
}

export interface ZernikeCoefficients {
  c3: number; // oblique astigmatism (Z_2^-2)
  c4: number; // defocus (Z_2^0)
  c5: number; // vertical astigmatism (Z_2^2)
}

export interface WavefrontSample {
  wavefront: Float32Array;
  mask: Float32Array;
}

export interface GeneratePSFOptions {
  N?: number;
  pupil_mm?: number;
  pupil_fill?: number;
  wavelength_micron?: number;
}

export interface GeneratePSFResult {
  zernike: ZernikeCoefficients;
  wavefront: Float32Array;
  mask: Float32Array;
  psf: Float32Array;
  N: number;
  pupilRpx: number;
  pupilRmm: number;
}

// ───────────────────────────────────────────────────────
// Step 1 — Refraction (S, C, A) → Zernike c3, c4, c5 [μm].
//
//   Source: Thibos LN, Applegate RA, Schwiegerling JT, Webb R;
//   VSIA Standards Taskforce. "Standards for reporting the
//   optical aberrations of eyes." J Refract Surg.
//   2002;18(5):S652–S660. (≡ ANSI Z80.28-2010.)
//
//   With pupil radius R (mm) and sphero-cylindrical refraction
//   (S, C, A), C in minus-cylinder convention:
//
//       c(2,-2) = −C · R² · sin(2A) / (4√6)    ← j = 3
//       c(2, 0) = −(S + C/2) · R² / (4√3)      ← j = 4
//       c(2,+2) = −C · R² · cos(2A) / (4√6)    ← j = 5
//
//   c₄는 *spherical equivalent* (S + C/2) — bare S가 아님.
// ───────────────────────────────────────────────────────
export function refractionToZernike(
  rx: Partial<RefractionRx> | null | undefined,
  pupilRmm: number = DEFAULT_PUPIL_MM,
): ZernikeCoefficients {
  const S = rx && typeof rx.sph === 'number' ? rx.sph : 0;
  const C = rx && typeof rx.cyl === 'number' ? rx.cyl : 0;
  const A_deg = rx && typeof rx.axis === 'number' ? rx.axis : 0;
  const A_rad = (A_deg * Math.PI) / 180;

  const R2 = pupilRmm * pupilRmm;
  const sphEq = S + C / 2;
  const sin2A = Math.sin(2 * A_rad);
  const cos2A = Math.cos(2 * A_rad);

  return {
    c3: (-C * R2 * sin2A) / (4 * SQRT6),
    c4: (-sphEq * R2) / (4 * SQRT3),
    c5: (-C * R2 * cos2A) / (4 * SQRT6),
  };
}

// ───────────────────────────────────────────────────────
// Step 2 — Sample wavefront W(ρ, θ) on N×N grid.
//
//   OSA radial polynomials (n=2):
//     Z(2,-2)(ρ,θ) = √6 · ρ²·sin(2θ)
//     Z(2, 0)(ρ,θ) = √3 · (2ρ² − 1)
//     Z(2,+2)(ρ,θ) = √6 · ρ²·cos(2θ)
//
//   ρ는 정규화된 동공 반지름 ∈ [0,1].
//   단위 원반 밖은 wavefront 미정의 (mask = 0).
//   wavefront 단위: μm. mask: 1 = 동공 내부, 0 = 외부.
// ───────────────────────────────────────────────────────
export function computeWavefront(
  zernike: Partial<ZernikeCoefficients>,
  N: number,
  pupilRpx: number,
): WavefrontSample {
  const wavefront = new Float32Array(N * N);
  const mask = new Float32Array(N * N);
  // Center between two middle pixels for even N
  const cx = N / 2 - 0.5;
  const cy = N / 2 - 0.5;
  const c3 = zernike.c3 ?? 0;
  const c4 = zernike.c4 ?? 0;
  const c5 = zernike.c5 ?? 0;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - cx) / pupilRpx;
      const dy = (y - cy) / pupilRpx;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) continue;
      const i = y * N + x;
      mask[i] = 1;
      const theta = Math.atan2(dy, dx);
      const Z3 = SQRT6 * r2 * Math.sin(2 * theta);
      const Z4 = SQRT3 * (2 * r2 - 1);
      const Z5 = SQRT6 * r2 * Math.cos(2 * theta);
      wavefront[i] = c3 * Z3 + c4 * Z4 + c5 * Z5;
    }
  }
  return { wavefront, mask };
}

// ───────────────────────────────────────────────────────
// Step 3 — Wavefront → intensity PSF via Fraunhofer.
//
//   1) 복소 pupil function P(x,y) = mask · exp(i·2π·W/λ)  (W,λ in μm)
//   2) ifftshift: 동공 중심을 (N/2,N/2) → (0,0)으로 옮김 (DFT 코너-원점)
//   3) FFT → amplitude PSF
//   4) |·|² → intensity PSF
//   5) sum = 1 정규화 (energy conservation; Wiener H가 합리적이려면 필수)
//
//   결과 PSF: peak가 (0,0) 코너에 wrap-around.
// ───────────────────────────────────────────────────────
export function wavefrontToPSF(
  wavefront: Float32Array,
  mask: Float32Array,
  N: number,
  wavelengthMicron: number = WAVELENGTH_MICRON,
): Float32Array {
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  const k = (2 * Math.PI) / wavelengthMicron;

  for (let i = 0; i < N * N; i++) {
    if (mask[i] > 0.5) {
      const phase = k * wavefront[i];
      re[i] = mask[i] * Math.cos(phase);
      im[i] = mask[i] * Math.sin(phase);
    }
    // Outside pupil: 둘 다 이미 0
  }

  // Move pupil center to (0,0) corner before FFT
  ifftshift2d(re, N);
  ifftshift2d(im, N);

  // Fraunhofer: amplitude PSF = FFT of pupil function
  fft2d(re, im, N, /* inverse= */ false);

  // Intensity = |amplitude|²
  const psf = new Float32Array(N * N);
  let sum = 0;
  for (let i = 0; i < N * N; i++) {
    const v = re[i] * re[i] + im[i] * im[i];
    psf[i] = v;
    sum += v;
  }

  if (sum > 0) {
    const inv = 1 / sum;
    for (let i = 0; i < N * N; i++) psf[i] *= inv;
  }
  return psf;
}

/** 세 단계를 묶은 편의 함수. */
export function generatePSF(
  rx: Partial<RefractionRx> | null | undefined,
  opts: GeneratePSFOptions = {},
): GeneratePSFResult {
  const N = opts.N ?? 64;
  const pupilRmm = opts.pupil_mm ?? DEFAULT_PUPIL_MM;
  // 동공 disc가 grid 반지름의 몇 %를 차지할지. 기본 0.85는 마진 확보.
  const pupilFill = opts.pupil_fill ?? 0.85;
  const wavelengthMicron = opts.wavelength_micron ?? WAVELENGTH_MICRON;

  const pupilRpx = pupilFill * (N / 2);
  const zernike = refractionToZernike(rx, pupilRmm);
  const { wavefront, mask } = computeWavefront(zernike, N, pupilRpx);
  const psf = wavefrontToPSF(wavefront, mask, N, wavelengthMicron);

  return { zernike, wavefront, mask, psf, N, pupilRpx, pupilRmm };
}

// ───────────────────────────────────────────────────────
// FFT shift helpers (in-place, even N only).
//
// N×N row-major, EVEN N에 대해 ifftshift와 fftshift는 동일:
// 대각선 사분면 교환.
//
//   Q1 | Q2          Q4 | Q3
//   ───┼───   →      ───┼───
//   Q3 | Q4          Q2 | Q1
// ───────────────────────────────────────────────────────
export function ifftshift2d(arr: Float64Array | Float32Array, N: number): void {
  const h = N / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      // Q1 ↔ Q4
      let i1 = y * N + x;
      let i2 = (y + h) * N + (x + h);
      let t = arr[i1];
      arr[i1] = arr[i2];
      arr[i2] = t;
      // Q2 ↔ Q3
      i1 = y * N + (x + h);
      i2 = (y + h) * N + x;
      t = arr[i1];
      arr[i1] = arr[i2];
      arr[i2] = t;
    }
  }
}

export const fftshift2d = ifftshift2d; // even N에서 동일

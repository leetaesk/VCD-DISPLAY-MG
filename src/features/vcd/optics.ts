/* ─────────────────────────────────────────────────────────
   optics.ts — Display-side optics helpers (LogMAR ↔ px, blur).
   원본: refraction-test.js / vision-test.js / csf-test.js 내부 함수들.
   ───────────────────────────────────────────────────────── */

/** Default pupil diameter assumption (mesopic, indoor daytime). */
export const DEFAULT_PUPIL_MM = 3.0;

/**
 * LogMAR L → 한 글자의 픽셀 높이 (Sloan letter 5×5 grid 기준).
 * arcmin = 5 × 10^L, distance_cm + ppi로 픽셀 환산.
 */
export function logmarToPx(logmar: number, distance_cm: number, ppi: number): number {
  const arcmin = 5 * Math.pow(10, logmar);
  const rad = (arcmin * Math.PI) / 10800;
  const mm = distance_cm * 10 * rad;
  return (mm * ppi) / 25.4;
}

/** arcmin → px (시청 거리 + ppi 기반). LogMAR/CSF 둘 다에서 사용. */
export function arcminToPx(arcmin: number, distance_cm: number, ppi: number): number {
  return arcmin * distance_cm * 10 * (Math.PI / 10800) * (ppi / 25.4);
}

/**
 * Defocus σ (display pixels) for |D| diopters.
 * disc_arcmin = |D| × pupil_mm × 3.4377
 * σ_arcmin    = disc_arcmin / 4
 */
export function diopterToBlurPx(
  D: number,
  distance_cm: number,
  ppi: number,
  pupil_mm: number = DEFAULT_PUPIL_MM,
): number {
  const a2p = arcminToPx(1, distance_cm, ppi);
  const disc_arcmin = Math.abs(D) * pupil_mm * 3.4377;
  const sigma_arcmin = disc_arcmin / 4;
  return sigma_arcmin * a2p;
}

/** LogMAR → Snellen 분모 (20/_). 음수도 가능. */
export function logmarToSnellen(logmar: number): string {
  const denom = Math.round(20 * Math.pow(10, logmar));
  return `20/${denom}`;
}

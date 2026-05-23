/**
 * 시각 검사용 상수.
 * 원본은 각 *-test.js 안에 흩어져 있던 magic number들을 모음.
 */

// ── LogMAR (ETDRS) ─────────────────────────────────────
/** LogMAR 단계 (큰 글자 → 작은 글자). 0.0 = 20/20, 음수 = 20/20보다 좋음. */
export const LOGMAR_STEPS = [
  1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2, -0.3,
] as const;

/** Sloan 표준 10자 — ETDRS / 굴절 검사에 공통. */
export const SLOAN_LETTERS = ['C', 'D', 'H', 'K', 'N', 'O', 'R', 'S', 'V', 'Z'] as const;

// ── CSF (대비 민감도) ─────────────────────────────────
/** 검사 공간 주파수 (cycles per degree). 옥타브 간격 + 끝점 보강. */
export const CSF_FREQUENCIES_CPD = [0.5, 1, 2, 4, 8, 12, 16] as const;

// ── Refraction (굴절 검사) ─────────────────────────────
/** Defocus staircase 단계 — round별로 좁아짐. (round 1 → 3) */
export const DEFOCUS_STEPS_D = [3, 1, 0.5] as const;

/** 난시 팬 차트 — 12방향, 15° 간격. */
export const FAN_CHART_ANGLES_DEG = Array.from({ length: 12 }, (_, i) => i * 15);

// ── 캘리브레이션 ───────────────────────────────────────
/** 신용카드 표준 (ISO/IEC 7810 ID-1). PPI 계산의 물리 기준. */
export const CREDIT_CARD_MM = { width: 85.6, height: 53.98 } as const;

/** 평균 인간 IPD(mm). MediaPipe 거리 계산의 핀홀 모델 가정. */
export const HUMAN_IPD_MM = 63;

/** 가정 카메라 수평 FOV (대부분 노트북/스마트폰 전면). */
export const ASSUMED_CAMERA_HFOV_DEG = 70;

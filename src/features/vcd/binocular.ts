/* ─────────────────────────────────────────────────────────
   binocular.ts — Scalar 가중치 + 온보딩 강도 곡선.

   원본: vcd-display/vcd-app/js/binocular-blend.js.

   책임 두 가지:

   1. computeWeights(gazePoint)
      gaze 위치 → 프레임 단위 OD/OS scalar 가중치:
        gaze 왼쪽 → OS 우세
        gaze 오른쪽 → OD 우세
        gaze 중앙 → 50/50
      sigmoid 기울기가 가팔라서 머리 미세 흔들림에는 둔감.

      Selfie-mirror 컨벤션: 카메라 페이지가 비디오를 mirror해서 표시하지만
      eye-tracker는 *원본* 이미지 좌표를 반환. 여기서  screen_x = 1 - gaze.x
      변환을 해주므로 호출자는 tracker 출력을 그대로 넘겨도 됨.

   2. strengthAt(seconds)
      카메라 페이지의 vcd-blend 셰이더에 넘길 보정 강도.
      baseline 0.2 → plateau 1.0 (15분 시그모이드, scale 5분).

   ⚠️ 원본의 loadOnboardingSeconds / saveOnboardingSeconds는 localStorage를
      직접 만지는 사이드이펙트 — 이 모듈은 순수 로직만 담음.
      누적 시간 저장은 store 계층(또는 호출 컴포넌트)이 책임진다.
   ───────────────────────────────────────────────────────── */

// ── Onboarding strength curve ───────────────────────────
export const HALF_POINT_S = 15 * 60; // 15분 — strength가 0.6 도달
export const SCALE_S = 5 * 60; // sigmoid slope
export const MIN_STRENGTH = 0.2;
export const MAX_STRENGTH = 1.0;
const STRENGTH_RANGE = MAX_STRENGTH - MIN_STRENGTH;

/**
 * 누적 활성 시간(초) → 보정 강도 ∈ [MIN_STRENGTH, MAX_STRENGTH].
 * 15분 sigmoid 중심, 5분 slope.
 */
export function strengthAt(seconds: number): number {
  const s = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const sig = 1 / (1 + Math.exp(-(s - HALF_POINT_S) / SCALE_S));
  return MIN_STRENGTH + STRENGTH_RANGE * sig;
}

// ── Binocular weights ──────────────────────────────────
/**
 * OD/OS 전환 sigmoid의 기울기.
 * k=6일 때 gaze.x=0.3 (selfie-flip 후 offset -0.2) → 가중치 0.23,
 * gaze.x=0.7 → 0.77. 자연스러우면서도 큰 시선 이동에는 명확히 반응.
 */
const SIGMOID_K = 6;

export interface GazePoint {
  x: number;
  y?: number;
}

export interface BinocularWeights {
  od: number;
  os: number;
  screenX: number;
}

/** gaze 좌표 → OD/OS 가중치. gaze가 없거나 NaN이면 50/50 폴백. */
export function computeWeights(gazePoint: GazePoint | null | undefined): BinocularWeights {
  if (!gazePoint || !Number.isFinite(gazePoint.x)) {
    return { od: 0.5, os: 0.5, screenX: 0.5 };
  }
  const screenX = clamp01(1 - gazePoint.x); // selfie-mirror flip
  const offset = screenX - 0.5; // [-0.5, +0.5]
  const odWeight = 1 / (1 + Math.exp(-offset * SIGMOID_K));
  return {
    od: odWeight,
    os: 1 - odWeight,
    screenX,
  };
}

// ── Helpers ────────────────────────────────────────────
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

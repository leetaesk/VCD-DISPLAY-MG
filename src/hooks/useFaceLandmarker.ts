import { useEffect, useRef, useState, type RefObject } from 'react';

import {
  FaceLandmarkerTracker,
  type FaceLandmarkerOptions,
  type TrackingFrame,
} from '@/features/eye-tracking/faceLandmarker';

/**
 * useFaceLandmarker — <video> ref를 받아 매 rAF에서 FaceLandmarker 샘플링.
 *
 * 결과는 **상태로 반환** (콜백 prop 금지 — vanilla EventEmitter 잔재).
 * 호출자는 distanceCm / ipdPx / gazePoint 등을 frame에서 직접 꺼냄.
 *
 * 라이프사이클:
 *   1) idle    — 캔버스/비디오가 아직 없거나 effect 전
 *   2) loading — FilesetResolver + 모델 다운로드 중
 *   3) running — 매 rAF에서 frame 갱신
 *   4) error   — load 실패 (WASM/모델 fetch, GPU delegate 미지원 등)
 *
 * StrictMode 안전성:
 *   dev에서 effect가 mount→cleanup→mount로 두 번 실행됨.
 *   - 첫 cleanup이 dispose()를 호출하므로 진행 중이던 load()는 disposed 플래그로
 *     깨끗이 폐기됨 (faceLandmarker 생성 직후 즉시 close).
 *   - rAF는 cancelAnimationFrame으로 종료.
 *   누수 없음.
 */
export type FaceLandmarkerStatus = 'idle' | 'loading' | 'running' | 'error';

export interface UseFaceLandmarkerResult {
  frame: TrackingFrame;
  status: FaceLandmarkerStatus;
  error: Error | null;
}

const INITIAL_FRAME: TrackingFrame = { ok: false, reason: 'init' };

export function useFaceLandmarker(
  videoRef: RefObject<HTMLVideoElement | null>,
  options?: FaceLandmarkerOptions,
): UseFaceLandmarkerResult {
  const [frame, setFrame] = useState<TrackingFrame>(INITIAL_FRAME);
  const [status, setStatus] = useState<FaceLandmarkerStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // options 식별성이 매 렌더마다 바뀌어도 effect 재실행을 막기 위해 ref에 보관.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let tracker: FaceLandmarkerTracker | null = new FaceLandmarkerTracker(video);
    let rafId = 0;
    let cancelled = false;

    setStatus('loading');
    setError(null);

    tracker
      .load(optionsRef.current ?? {})
      .then(() => {
        if (cancelled) return;
        setStatus('running');

        const tick = () => {
          if (cancelled || !tracker) return;
          setFrame(tracker.sample());
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(e instanceof Error ? e : new Error(String(e)));
      });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      tracker?.dispose();
      tracker = null;
      setStatus('idle');
    };
  }, [videoRef]);

  return { frame, status, error };
}

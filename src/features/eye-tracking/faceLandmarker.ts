/* ─────────────────────────────────────────────────────────
   faceLandmarker.ts — MediaPipe Tasks Vision wrapper for OD/OS tracking.

   원본: vcd-display/vcd-app/js/eye-tracker.js.

   변경점:
   - global FaceLandmarker/FilesetResolver → npm `@mediapipe/tasks-vision` 직접 import.
     이로써 vanilla 시절의 "스크립트 로딩 race + window 글로벌 의존" 모두 제거.
   - rAF 루프와 lifecycle은 별도 훅(useFaceLandmarker)이 소유.
     이 모듈은 순수 클래스 — getUserMedia 안 만지고 <video> 엘리먼트를 받음.

   478 landmarks (468 face + 10 iris):
     468 = right iris center (OD), 469~472 = OD iris boundary
     473 = left  iris center (OS), 474~477 = OS iris boundary

   거리 추정: outer canthi (lm 33, 263) 간격 + 핀홀 카메라 모델.
   ───────────────────────────────────────────────────────── */
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

import { ASSUMED_CAMERA_HFOV_DEG, HUMAN_IPD_MM } from '@/constants/vision';

// outer canthi 거리 / IPD 비율 — 평균 안면 해부 데이터로 1.06.
const OUTER_TO_IPD_SCALE = 1 / 1.06;

/** 모델 / WASM 호스팅 경로. 기본은 CDN; 로컬로 옮기려면 옵션에서 덮어쓰기. */
const DEFAULT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface PupilSample {
  x: number;
  y: number;
  radiusImage: number;
  confidence: number;
}

export interface TrackingResult {
  ok: true;
  odPupil: PupilSample;
  osPupil: PupilSample;
  /** 양 동공 중점 (raw image 좌표 [0,1]). selfie-mirror 변환은 하지 않음. */
  gazePoint: { x: number; y: number };
  /** outer canthi 픽셀 거리 추정에서 환산한 시청 거리 (cm). */
  distanceCm: number;
  /** outer canthi에서 환산한 IPD (픽셀). */
  ipdPx: number;
  confidence: number;
}

export interface TrackingFailure {
  ok: false;
  reason: 'init' | 'no_face' | 'no_iris';
}

export type TrackingFrame = TrackingResult | TrackingFailure;

export interface FaceLandmarkerOptions {
  wasmBasePath?: string;
  modelAssetPath?: string;
  /** GPU delegate가 안 되는 환경은 'CPU' 로 폴백. */
  delegate?: 'GPU' | 'CPU';
}

export class FaceLandmarkerTracker {
  private readonly video: HTMLVideoElement;
  private faceLandmarker: FaceLandmarker | null = null;
  private lastResult: TrackingFrame = { ok: false, reason: 'init' };
  private disposed = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** 모델 다운로드 + WASM 초기화. start 후에는 sample()을 매 rAF에서 호출. */
  async load(opts: FaceLandmarkerOptions = {}): Promise<void> {
    if (this.disposed) throw new Error('FaceLandmarkerTracker: disposed');

    const vision = await FilesetResolver.forVisionTasks(opts.wasmBasePath ?? DEFAULT_WASM_BASE);
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: opts.modelAssetPath ?? DEFAULT_MODEL_URL,
        delegate: opts.delegate ?? 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // dispose가 load 도중에 호출됐다면 즉시 해제.
    if (this.disposed) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
  }

  /** 한 프레임 샘플링. 비디오가 준비 안 됐으면 lastResult 그대로 반환. */
  sample(): TrackingFrame {
    if (!this.faceLandmarker || this.disposed) return this.lastResult;
    if (this.video.readyState < 2 || this.video.paused) return this.lastResult;
    try {
      const r = this.faceLandmarker.detectForVideo(this.video, performance.now());
      this.lastResult = this.processResult(r.faceLandmarks);
    } catch {
      // teardown 도중의 일시 오류 — 무시
    }
    return this.lastResult;
  }

  get(): TrackingFrame {
    return this.lastResult;
  }

  dispose(): void {
    this.disposed = true;
    if (this.faceLandmarker) {
      try {
        this.faceLandmarker.close();
      } catch {
        /* ignore */
      }
      this.faceLandmarker = null;
    }
  }

  // ── private ───────────────────────────────────────────
  private processResult(faces: NormalizedLandmark[][] | undefined): TrackingFrame {
    if (!faces || faces.length === 0) return { ok: false, reason: 'no_face' };
    const lms = faces[0];

    const od = lms[468];
    const os = lms[473];
    if (!od || !os) return { ok: false, reason: 'no_iris' };

    // Iris radii (normalized image coords) — 중심에서 4개 경계점까지 평균.
    const odRadius =
      (dist2(od, lms[469]) + dist2(od, lms[470]) + dist2(od, lms[471]) + dist2(od, lms[472])) / 4;
    const osRadius =
      (dist2(os, lms[474]) + dist2(os, lms[475]) + dist2(os, lms[476]) + dist2(os, lms[477])) / 4;

    // 거리 = (IPD_mm × focal_px) / IPD_px. focal_px는 hFOV 가정에서 도출.
    const outerL = lms[33];
    const outerR = lms[263];
    const w = this.video.videoWidth || 640;
    const dx = (outerR.x - outerL.x) * w;
    const dy = (outerR.y - outerL.y) * w;
    const outerPx = Math.hypot(dx, dy);
    const ipdPx = outerPx * OUTER_TO_IPD_SCALE;
    const fovRad = (ASSUMED_CAMERA_HFOV_DEG * Math.PI) / 180;
    const focalPx = w / 2 / Math.tan(fovRad / 2);
    const distanceCm = (HUMAN_IPD_MM * focalPx) / Math.max(1, ipdPx) / 10;

    // 시선 = 양 동공 중점 (raw image 좌표).
    const gazeX = (od.x + os.x) / 2;
    const gazeY = (od.y + os.y) / 2;

    // 신뢰도 = 좌우 iris 반지름 대칭성 (가림/회전 시 깨짐).
    const radiusRatio =
      odRadius && osRadius ? Math.min(odRadius, osRadius) / Math.max(odRadius, osRadius) : 0;
    const trackConf = Math.max(0.4, Math.min(0.95, radiusRatio));

    return {
      ok: true,
      odPupil: { x: od.x, y: od.y, radiusImage: odRadius, confidence: trackConf },
      osPupil: { x: os.x, y: os.y, radiusImage: osRadius, confidence: trackConf },
      gazePoint: { x: gazeX, y: gazeY },
      distanceCm,
      ipdPx,
      confidence: trackConf,
    };
  }
}

function dist2(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

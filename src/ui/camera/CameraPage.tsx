import { useEffect, useMemo, useRef, useState } from 'react';

import { Link } from 'react-router-dom';

import { ROUTES } from '@/constants/routes';
import { computeWeights, strengthAt } from '@/features/vcd/binocular';
import { CameraPipeline, type CameraMode, type FrameTimings } from '@/features/vcd/cameraPipeline';
import { fft2dPacked } from '@/features/vcd/fft';
import {
  createGLContext,
  createPipelinePrograms,
  disposeGLContext,
  disposePipelinePrograms,
  type GLContext,
  type PipelinePrograms,
} from '@/features/vcd/glContext';
import { generatePSF } from '@/features/vcd/psf';
import { useFaceLandmarker } from '@/hooks/useFaceLandmarker';
import { useProfileStore } from '@/store/profileStore';
import { friendlyCamMessage } from '@/utils/camera';
import type { Eye, EyeRefraction, VCDProfile } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   CameraPage — 실시간 카메라 → VCD 파이프라인 → 화면.
   원본: camera-correction.js (그레이스케일 VCD 경로만 이식).

   기능:
   - getUserMedia (전/후면 토글)
   - PSF 캐시 per (eye, sph/cyl/axis, N)
   - 단일/양안 모드 (양안: useFaceLandmarker로 gaze 추적)
   - K 슬라이더 (5단계 log)
   - 자동 해상도 다운스케일 (30ms 초과 → 256→128→64)
   - 퍼포먼스 HUD (FPS, frame ms, step ms)

   제외 (Phase 6 범위 외):
   - M3 색각 보정 / M2 Amsler 필드 리맵 — useEffect 추가만으로 확장 가능
   ───────────────────────────────────────────────────────── */

const RES_LEVELS = [256, 128, 64];
const DOWN_THRESHOLD_MS = 30;
const UP_THRESHOLD_MS = 15;
const DOWN_FRAMES_NEEDED = 30;
const UP_FRAMES_NEEDED = 60;

const K_LEVELS = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1];
const K_LABELS = ['선명함 강하게', '선명함', '균형', '약하게', '노이즈 적게'];

function CameraPage() {
  const profile = useProfileStore((s) => s.profile);
  if (!hasRefraction(profile)) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-md border border-warn/40 bg-warn/5 p-5">
          <h3 className="mb-2 text-lg font-semibold text-warn">🔭 굴절 검사가 먼저 필요합니다</h3>
          <p className="mb-3 text-sm text-text">
            카메라 보정은 사용자의 SPH / CYL / AXIS로 계산된 PSF를 사용합니다.
          </p>
          <Link
            to={ROUTES.refraction}
            className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
          >
            굴절 검사 시작 →
          </Link>
        </div>
      </div>
    );
  }
  return <CameraApp profile={profile} />;
}

export default CameraPage;

function hasRefraction(p: VCDProfile): boolean {
  return !!p.refraction && (!!p.refraction.od || !!p.refraction.os);
}

function CameraApp({ profile }: { profile: VCDProfile }) {
  const odOk = !!profile.refraction?.od;
  const osOk = !!profile.refraction?.os;

  // UI state
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [applyVCD, setApplyVCD] = useState(true);
  const [eye, setEye] = useState<Eye>(odOk ? 'od' : 'os');
  const [kLevel, setKLevel] = useState(3);
  const [binocular, setBinocular] = useState(false);
  const [resLevel, setResLevel] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const binocularEligible = odOk && osOk;

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Camera stream
  const [streamError, setStreamError] = useState<Error | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!cancelled) {
          setStreamReady(true);
          setStreamError(null);
        }
      } catch (e) {
        if (!cancelled) setStreamError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      cancelled = true;
      setStreamReady(false);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      try {
        video.pause();
        video.srcObject = null;
      } catch {
        /* ignore */
      }
    };
  }, [facing]);

  // FaceLandmarker (binocular 모드일 때만 의미 있지만 항상 실행 — gaze 표시 등)
  const tracker = useFaceLandmarker(videoRef);

  // WebGL context + pipeline (해상도 변경 시 재생성)
  const [glState, setGlState] = useState<{
    ctx: GLContext;
    programs: PipelinePrograms;
    pipeline: CameraPipeline;
  } | null>(null);
  const [glError, setGlError] = useState<Error | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const N = RES_LEVELS[resLevel];
    cv.width = cv.height = N;
    let ctx: GLContext | null = null;
    let programs: PipelinePrograms | null = null;
    let pipeline: CameraPipeline | null = null;
    try {
      ctx = createGLContext(cv);
      programs = createPipelinePrograms(ctx.gl);
      pipeline = new CameraPipeline(ctx, programs, N);
      setGlState({ ctx, programs, pipeline });
      setGlError(null);
    } catch (e) {
      setGlError(e instanceof Error ? e : new Error(String(e)));
    }
    return () => {
      if (pipeline) pipeline.destroy();
      if (ctx && programs) disposePipelinePrograms(ctx.gl, programs);
      if (ctx) disposeGLContext(ctx);
      setGlState(null);
    };
  }, [resLevel]);

  // PSF cache per eye, recomputed on (rx, N) change
  const psfCacheRef = useRef<{ od: string | null; os: string | null }>({ od: null, os: null });
  useEffect(() => {
    const gl = glState;
    if (!gl) return;
    psfCacheRef.current = { od: null, os: null };
  }, [glState]);

  const ensurePSFs = (pipeline: CameraPipeline) => {
    const r = profile.refraction;
    if (!r) return;
    const N = pipeline.N;
    for (const e of ['od', 'os'] as Eye[]) {
      const rx = r[e];
      if (!rx) continue;
      const key = `${rx.sph}|${rx.cyl}|${rx.axis}|N${N}`;
      if (key === psfCacheRef.current[e]) continue;
      const psfData = generatePSF(rx, { N, pupil_mm: 3.0 });
      const psfPacked = new Float32Array(N * N * 2);
      for (let i = 0; i < N * N; i++) psfPacked[i * 2] = psfData.psf[i];
      const H = fft2dPacked(psfPacked, N, false);
      if (e === 'od') pipeline.uploadHOd(H);
      else pipeline.uploadHOs(H);
      psfCacheRef.current[e] = key;
    }
  };

  // Render loop
  const [perf, setPerf] = useState({
    fps: 0,
    frameMs: 0,
    pipelineMs: 0,
    steps: emptyTimings(),
    res: RES_LEVELS[0],
  });
  const [onboardingSec, setOnboardingSec] = useState(0);
  const overBudgetRef = useRef(0);
  const underBudgetRef = useRef(0);

  useEffect(() => {
    if (!glState || !streamReady) return;
    const pipeline = glState.pipeline;
    const video = videoRef.current!;
    let raf = 0;
    let lastFpsTs = performance.now();
    let frameCount = 0;
    let lastFrameTs = 0;
    const timings: FrameTimings = emptyTimings();
    const onboardLocal = { sec: onboardingSec };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.videoWidth === 0) return;
      const tFrame0 = performance.now();
      ensurePSFs(pipeline);

      const useBinocular = binocular && binocularEligible && tracker.frame.ok;
      const mode: CameraMode = useBinocular ? 'binocular' : eye;
      const weights = useBinocular
        ? computeWeights(tracker.frame.ok ? tracker.frame.gazePoint : null)
        : { od: eye === 'od' ? 1 : 0, os: eye === 'os' ? 1 : 0, screenX: 0.5 };

      const onboardStrength = strengthAt(onboardLocal.sec);
      const strength = applyVCD ? onboardStrength : 0;

      const tPipe0 = performance.now();
      pipeline.renderFrame(
        video,
        K_LEVELS[kLevel - 1],
        mode,
        weights,
        strength,
        facing === 'user',
        timings,
      );
      const pipelineMs = performance.now() - tPipe0;
      const frameMs = performance.now() - tFrame0;

      if (useBinocular && applyVCD) {
        const dt = lastFrameTs ? Math.min(0.1, (t - lastFrameTs) / 1000) : 0;
        onboardLocal.sec += dt;
      }
      lastFrameTs = t;

      frameCount++;
      if (t - lastFpsTs > 500) {
        const dt = (t - lastFpsTs) / 1000;
        setPerf({
          fps: frameCount / dt,
          frameMs,
          pipelineMs,
          steps: { ...timings },
          res: pipeline.N,
        });
        setOnboardingSec(onboardLocal.sec);
        frameCount = 0;
        lastFpsTs = t;
      }

      if (applyVCD) {
        if (pipelineMs > DOWN_THRESHOLD_MS) {
          overBudgetRef.current++;
          underBudgetRef.current = 0;
          if (
            overBudgetRef.current >= DOWN_FRAMES_NEEDED &&
            resLevel < RES_LEVELS.length - 1
          ) {
            setResLevel(resLevel + 1);
            overBudgetRef.current = 0;
            setBanner(`성능 모드: 해상도 자동 조정 → ${RES_LEVELS[resLevel + 1]}×${RES_LEVELS[resLevel + 1]}`);
          }
        } else if (pipelineMs < UP_THRESHOLD_MS) {
          underBudgetRef.current++;
          overBudgetRef.current = 0;
          if (underBudgetRef.current >= UP_FRAMES_NEEDED && resLevel > 0) {
            setResLevel(resLevel - 1);
            underBudgetRef.current = 0;
            setBanner(`해상도 복원 → ${RES_LEVELS[resLevel - 1]}×${RES_LEVELS[resLevel - 1]}`);
          }
        } else {
          overBudgetRef.current = Math.max(0, overBudgetRef.current - 1);
          underBudgetRef.current = Math.max(0, underBudgetRef.current - 1);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glState, streamReady, eye, kLevel, applyVCD, binocular, facing, resLevel, tracker.frame, binocularEligible]);

  // Banner auto-hide
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 4000);
    return () => window.clearTimeout(id);
  }, [banner]);

  const stageLabel = useMemo(() => {
    if (!applyVCD) return '보정 없음';
    return binocular && binocularEligible && tracker.status === 'running' ? '양안 VCD' : '단일 VCD';
  }, [applyVCD, binocular, binocularEligible, tracker.status]);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold text-text">
          카메라 보정{' '}
          <span className="ml-2 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
            {stageLabel}
          </span>
        </h2>
        <div className="font-mono text-xs text-text-dim">
          OD: <span className="text-text">{fmtRx(profile.refraction?.od)}</span> · OS:{' '}
          <span className="text-text">{fmtRx(profile.refraction?.os)}</span>
        </div>
      </header>

      {streamError && (
        <ErrorBanner message={friendlyCamMessage(streamError)} />
      )}
      {glError && <ErrorBanner message={`WebGL: ${glError.message}`} />}
      {tracker.status === 'error' && (
        <ErrorBanner message={`FaceLandmarker: ${tracker.error?.message ?? '로드 실패'}`} />
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Seg
          label="시야 시뮬"
          options={[
            { v: 'false', label: '보정 없음' },
            { v: 'true', label: 'VCD 적용' },
          ]}
          value={String(applyVCD)}
          onChange={(v) => setApplyVCD(v === 'true')}
        />
        <Seg
          label="검사 눈"
          options={[
            { v: 'od', label: 'OD', disabled: !odOk },
            { v: 'os', label: 'OS', disabled: !osOk },
          ]}
          value={eye}
          onChange={(v) => setEye(v as Eye)}
        />
        <Seg
          label="카메라"
          options={[
            { v: 'user', label: '전면' },
            { v: 'environment', label: '후면' },
          ]}
          value={facing}
          onChange={(v) => setFacing(v as 'user' | 'environment')}
        />
        <Seg
          label="양안 보정"
          options={[
            { v: 'off', label: '단일 눈' },
            {
              v: 'on',
              label: '양안',
              disabled: !binocularEligible || tracker.status !== 'running',
            },
          ]}
          value={binocular ? 'on' : 'off'}
          onChange={(v) => setBinocular(v === 'on')}
        />
      </div>

      {/* K slider */}
      <div className="mb-3 rounded-md border border-line bg-bg-elev p-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-text-dim">선명함 강하게</span>
          <span className="font-mono text-text">
            {K_LABELS[kLevel - 1]} · K = {K_LEVELS[kLevel - 1].toExponential(0)}
          </span>
          <span className="text-text-dim">노이즈 적게</span>
        </div>
        <input
          type="range"
          min={1}
          max={K_LEVELS.length}
          step={1}
          value={kLevel}
          onChange={(e) => setKLevel(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Display */}
      <div className="mb-3 flex justify-center">
        <canvas
          ref={canvasRef}
          className="aspect-square w-full max-w-96 rounded-md border border-line bg-black"
          style={{ imageRendering: 'pixelated' }}
        />
        <video ref={videoRef} playsInline muted hidden />
      </div>

      {banner && (
        <div className="mb-3 rounded-md border border-accent/40 bg-accent/5 p-2 text-center text-xs text-accent">
          {banner}
        </div>
      )}

      {/* Perf HUD */}
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="FPS" value={Math.round(perf.fps).toString()} />
        <Metric label="프레임 ms" value={perf.frameMs.toFixed(1)} />
        <Metric
          label="파이프라인 ms"
          value={perf.pipelineMs.toFixed(1)}
          tone={perf.pipelineMs < 20 ? 'ok' : perf.pipelineMs < 30 ? 'warn' : 'err'}
        />
        <Metric label="해상도" value={`${perf.res}×${perf.res}`} />
      </div>

      <details className="rounded-md border border-line bg-bg-elev p-3 text-xs">
        <summary className="cursor-pointer text-text-dim">단계별 ms (디버그)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
          <StepMs label="비디오 업로드" v={perf.steps.upload} />
          <StepMs label="grayPack" v={perf.steps.grayPack} />
          <StepMs label="FFT" v={perf.steps.fft} />
          <StepMs label="binoBlend" v={perf.steps.binoBlend} />
          <StepMs label="vcdBlend" v={perf.steps.vcdBlend} />
          <StepMs label="IFFT" v={perf.steps.ifft} />
          <StepMs label="output" v={perf.steps.output} />
        </div>
      </details>

      <p className="mt-3 text-xs text-text-dim">
        누적 적응 시간: {Math.floor(onboardingSec)}초 · 강도{' '}
        {(strengthAt(onboardingSec) * 100).toFixed(0)}%
      </p>
    </div>
  );
}

function emptyTimings(): FrameTimings {
  return {
    upload: 0,
    grayPack: 0,
    fft: 0,
    binoBlend: 0,
    vcdBlend: 0,
    ifft: 0,
    output: 0,
  };
}

function fmtRx(e: EyeRefraction | null | undefined): string {
  if (!e) return '--';
  const sph = (e.sph > 0 ? '+' : '') + e.sph.toFixed(2);
  return `${sph}/${e.cyl.toFixed(2)}×${e.axis}°`;
}

// ── UI bits ───────────────────────────────────────────
function Seg({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { v: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-dim">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.v)}
            className={[
              'flex-1 px-2 py-1.5',
              value === o.v ? 'bg-accent text-bg' : 'bg-bg-elev-2 text-text hover:bg-bg-elev',
              o.disabled ? 'cursor-not-allowed opacity-40' : '',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
}) {
  const cls = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'err' ? 'text-err' : 'text-text';
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3">
      <div className="text-xs text-text-dim">{label}</div>
      <div className={['font-mono text-lg', cls].join(' ')}>{value}</div>
    </div>
  );
}

function StepMs({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between rounded-sm bg-bg-elev-2 px-2 py-1">
      <span className="text-text-dim">{label}</span>
      <span className="text-text">{v.toFixed(2)}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 rounded-md border border-err/40 bg-err/5 p-3 text-sm text-err">
      {message}
    </div>
  );
}

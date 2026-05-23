import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { CREDIT_CARD_MM, ROUTES } from '@/constants';
import { useFaceLandmarker } from '@/hooks/useFaceLandmarker';
import { useProfileStore } from '@/store/profileStore';
import { friendlyCamMessage } from '@/utils/camera';

/* ─────────────────────────────────────────────────────────
   CalibrationPage — 3-step PPI + viewing distance wizard.

   원본: vcd-display/vcd-app/js/calibration.js + page-calibration template.

   Step 1: 신용카드 절반 슬라이더 → screen_ppi (+ screen_width_mm 도출)
   Step 2: MediaPipe FaceLandmarker로 5초 거리 샘플링 (median + tolerance mean)
   Step 3: 결과 요약 + 굴절로 이동

   useFaceLandmarker 훅이 rAF + dispose를 책임지므로 여기서는 frame을
   read-only로 받기만 함.
   ───────────────────────────────────────────────────────── */

const HALF_CARD_W_MM = CREDIT_CARD_MM.width / 2;
const HALF_CARD_H_RATIO = CREDIT_CARD_MM.height / HALF_CARD_W_MM;
const SAMPLE_SECONDS = 5;
const STABILITY_TOLERANCE_CM = 5;

type Step = 1 | 2 | 3;

function CalibrationPage() {
  const [step, setStep] = useState<Step>(1);
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold text-text">캘리브레이션</h2>
        <p className="text-text-dim">
          화면의 실제 크기와 사용자의 시청 거리를 측정합니다. 모든 검사가 이 값에 의존합니다.
        </p>
      </header>

      <Stepper current={step} />

      {step === 1 && (
        <Step1
          onNext={(ppi, widthMm) => {
            update((p) => ({
              ...p,
              calibration: {
                screen_ppi: round1(ppi),
                screen_width_mm: round1(widthMm),
                viewing_distance_cm: profile.calibration?.viewing_distance_cm ?? 60,
                distance_source: profile.calibration?.distance_source ?? 'manual',
                calibration_timestamp:
                  profile.calibration?.calibration_timestamp ?? new Date().toISOString(),
              },
            }));
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <Step2
          onSave={(distanceCm, source) => {
            update((p) => ({
              ...p,
              calibration: {
                screen_ppi: p.calibration?.screen_ppi ?? 96,
                screen_width_mm: p.calibration?.screen_width_mm ?? 300,
                viewing_distance_cm: round1(distanceCm),
                distance_source: source,
                calibration_timestamp: new Date().toISOString(),
              },
            }));
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <Step3
          onRedo={() => {
            update((p) => ({ ...p, calibration: null }));
            setStep(1);
          }}
        />
      )}
    </div>
  );
}

export default CalibrationPage;

// ── Stepper ───────────────────────────────────────────
function Stepper({ current }: { current: Step }) {
  const items: { n: Step; label: string }[] = [
    { n: 1, label: '1. PPI' },
    { n: 2, label: '2. 거리' },
    { n: 3, label: '3. 확인' },
  ];
  return (
    <ol className="mb-6 flex gap-2">
      {items.map((it) => (
        <li
          key={it.n}
          className={[
            'rounded-md border px-3 py-1.5 text-xs',
            it.n === current
              ? 'border-accent bg-accent/10 text-accent'
              : it.n < current
                ? 'border-ok/40 bg-ok/5 text-ok'
                : 'border-line bg-bg-elev text-text-dim',
          ].join(' ')}
        >
          {it.label}
        </li>
      ))}
    </ol>
  );
}

// ── Step 1: PPI via half credit card ──────────────────
function Step1({ onNext }: { onNext: (ppi: number, widthMm: number) => void }) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const initial = Math.min(
    500,
    Math.max(80, Math.round((HALF_CARD_W_MM * (96 * dpr)) / 25.4)),
  );
  const [w, setW] = useState(initial);

  const h = w * HALF_CARD_H_RATIO;
  const ppi = (w / HALF_CARD_W_MM) * 25.4;
  const screenWidthMm = (window.screen.width / ppi) * 25.4;

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">1단계 — 화면 PPI 측정</h3>
      <p className="mb-4 text-sm text-text-dim">
        실제 신용카드를 화면에 대고, 카드 <strong>오른쪽 절반</strong>이 파선과 맞도록
        슬라이더를 조절해 주세요.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-dim">
          크기 조절
          <input
            type="range"
            min={80}
            max={500}
            step={1}
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
            className="w-64"
          />
        </label>
        <output className="font-mono text-sm text-text">
          {w}px × {h.toFixed(1)}px → {ppi.toFixed(1)} PPI
        </output>
      </div>

      <div className="mb-4 flex items-center justify-center rounded-md border border-dashed border-line bg-bg p-6">
        <div
          role="img"
          aria-label="신용카드 오른쪽 절반 가이드"
          className="bg-text-dim/15"
          style={{
            width: `${w}px`,
            height: `${h}px`,
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent 0 6px, rgba(110,168,255,0.4) 6px 7px)',
            border: '1px dashed var(--color-accent)',
          }}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onNext(ppi, screenWidthMm)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          다음 →
        </button>
      </div>
    </section>
  );
}

// ── Step 2: viewing distance via MediaPipe ────────────
function Step2({
  onSave,
}: {
  onSave: (distanceCm: number, source: 'mediapipe_ipd' | 'manual') => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [streamError, setStreamError] = useState<Error | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState(60);

  // getUserMedia (훅이 video 엘리먼트를 받아야 하므로 여기서 stream 수동 관리)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setStreamReady(true);
      } catch (e) {
        if (!cancelled) setStreamError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      try {
        video.pause();
        video.srcObject = null;
      } catch {
        /* ignore */
      }
    };
  }, []);

  // 훅은 videoRef를 받아서 매 rAF에서 sample(). video가 아직 없거나
  // 일시정지면 hook 내부에서 alone read 안 함 — streamReady와 무관하게 항상 전달.
  const tracker = useFaceLandmarker(videoRef);

  // 5초 sampling
  const samplesRef = useRef<number[]>([]);
  const startTsRef = useRef<number>(0);
  const [progress, setProgress] = useState(0);
  const [stableCm, setStableCm] = useState<number | null>(null);
  const [windowClosed, setWindowClosed] = useState(false);

  useEffect(() => {
    if (!streamReady) return;
    startTsRef.current = performance.now();
    samplesRef.current = [];
    setProgress(0);
    setStableCm(null);
    setWindowClosed(false);
  }, [streamReady]);

  useEffect(() => {
    if (!streamReady) return;
    if (tracker.frame.ok) {
      const d = tracker.frame.distanceCm;
      if (Number.isFinite(d) && d > 10 && d < 200) {
        const buf = samplesRef.current;
        buf.push(d);
        if (buf.length > 200) buf.shift();
        const recent = buf.slice(-60);
        const med = median(recent);
        const stable = recent.filter((v) => Math.abs(v - med) <= STABILITY_TOLERANCE_CM);
        setStableCm(stable.length ? mean(stable) : med);
      }
    }
    const elapsed = (performance.now() - startTsRef.current) / 1000;
    const p = Math.min(SAMPLE_SECONDS, elapsed);
    setProgress(p);
    if (elapsed >= SAMPLE_SECONDS && !windowClosed) {
      setWindowClosed(true);
      if (samplesRef.current.length < 3) setManualMode(true);
    }
  }, [tracker.frame, streamReady, windowClosed]);

  // overlay 그리기 — face line
  useEffect(() => {
    const cv = overlayRef.current;
    const video = videoRef.current;
    if (!cv || !video) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (tracker.frame.ok) {
      const od = tracker.frame.odPupil;
      const os = tracker.frame.osPupil;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(od.x * w, od.y * h);
      ctx.lineTo(os.x * w, os.y * h);
      ctx.stroke();
      ctx.strokeStyle = '#6ea8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(od.x * w, od.y * h);
      ctx.lineTo(os.x * w, os.y * h);
      ctx.stroke();
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath();
      ctx.arc(od.x * w, od.y * h, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(os.x * w, os.y * h, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (cv.width > 0 && cv.height > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h * 0.4, w, h * 0.2);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(14, Math.round(h * 0.04))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('얼굴을 카메라 정면에 위치시켜 주세요', w / 2, h * 0.5);
    }
  }, [tracker.frame]);

  const ipdPx = tracker.frame.ok ? tracker.frame.ipdPx : null;
  const saveDisabled =
    !windowClosed || !stableCm || stableCm < 10 || stableCm > 200;

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">2단계 — 시청 거리 측정</h3>
      <p className="mb-3 text-sm text-text-dim">
        카메라 정면을 응시하세요. 5초간 안면 위치를 샘플링합니다.
      </p>

      {streamError && (
        <ErrorCard
          message={friendlyCamMessage(streamError)}
          onSwitchManual={() => setManualMode(true)}
        />
      )}
      {tracker.status === 'error' && (
        <ErrorCard
          message={
            tracker.error?.message ?? 'FaceLandmarker 초기화에 실패했습니다.'
          }
          onSwitchManual={() => setManualMode(true)}
        />
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
        <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 h-full w-full"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <Readout label="IPD" value={ipdPx ? `${ipdPx.toFixed(1)} px` : '--'} />
          <Readout
            label="거리"
            value={stableCm ? `${stableCm.toFixed(1)} cm` : '--'}
          />
          <Readout
            label="진행"
            value={`${progress.toFixed(1)}/${SAMPLE_SECONDS}초`}
          />
          <Readout label="상태" value={statusLabel(tracker.status)} />
        </div>
      </div>

      {manualMode && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-warn/30 bg-warn/5 p-3">
          <label className="flex flex-col text-sm text-text-dim">
            거리 (cm)
            <input
              type="number"
              min={20}
              max={120}
              step={1}
              value={manualValue}
              onChange={(e) => setManualValue(Number(e.target.value))}
              className="w-32 rounded-md border border-line bg-bg-elev-2 px-2 py-1 text-text"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (manualValue >= 20 && manualValue <= 120) onSave(manualValue, 'manual');
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:bg-accent-2"
          >
            수동 저장
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => setManualMode((v) => !v)}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          수동 입력
        </button>
        <button
          type="button"
          onClick={() => {
            if (stableCm) onSave(stableCm, 'mediapipe_ipd');
          }}
          disabled={saveDisabled}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-text-dim"
        >
          저장 → 다음
        </button>
      </div>
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg-elev-2 px-3 py-2">
      <span className="text-text-dim">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

function ErrorCard({
  message,
  onSwitchManual,
}: {
  message: string;
  onSwitchManual: () => void;
}) {
  return (
    <div className="mb-3 rounded-md border border-err/40 bg-err/5 p-3">
      <div className="mb-1 text-sm font-semibold text-err">카메라를 시작할 수 없습니다</div>
      <p className="mb-2 text-xs text-text">{message}</p>
      <button
        type="button"
        onClick={onSwitchManual}
        className="rounded-md border border-line bg-bg-elev-2 px-2.5 py-1 text-xs hover:border-accent"
      >
        수동 입력으로 전환
      </button>
    </div>
  );
}

function statusLabel(s: 'idle' | 'loading' | 'running' | 'error'): string {
  switch (s) {
    case 'idle':
      return '대기';
    case 'loading':
      return '로딩 중…';
    case 'running':
      return '추적 중';
    case 'error':
      return '오류';
  }
}

// ── Step 3 ────────────────────────────────────────────
function Step3({ onRedo }: { onRedo: () => void }) {
  const profile = useProfileStore((s) => s.profile);
  const navigate = useNavigate();
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">3단계 — 확인</h3>
      <pre className="mb-4 overflow-x-auto rounded-md bg-bg-elev-2 p-3 font-mono text-xs text-text">
        {JSON.stringify(profile.calibration ?? {}, null, 2)}
      </pre>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onRedo}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          다시 측정
        </button>
        <button
          type="button"
          onClick={() => navigate(ROUTES.refraction)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          완료 → 굴절 검사 시작
        </button>
      </div>
    </section>
  );
}

// ── utils ─────────────────────────────────────────────
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import GateCalibration from '@/components/GateCalibration';
import { CSF_FREQUENCIES_CPD, ROUTES } from '@/constants';
import {
  MAX_TRIALS_PER_FREQ,
  REVERSALS_NEEDED,
  aggregateEyeResult,
  freshStaircase,
  pxPerCycle,
  severityRank,
  staircaseStep,
  type ClassificationResult,
  type EyeResult,
  type Staircase,
} from '@/features/vcd/csf';
import { useProfileStore } from '@/store/profileStore';
import type { CSFEye, Calibration, Eye } from '@/types/profile';

import CSFChart from './CSFChart';

/* ─────────────────────────────────────────────────────────
   CsfPage — 7 frequencies × interleaved 3-down/1-up staircase.
   원본: csf-test.js + page-csf template.
   ───────────────────────────────────────────────────────── */

const BOX_PX_MAX = 240;
const BOX_PX_MIN = 120;
const FEEDBACK_MS = 180;

type Phase = 'intro' | 'test' | 'test_preview' | 'combined';

interface Trial {
  cpd: number;
  contrast: number;
  gratingSide: 'left' | 'right';
  startTs: number;
  awaiting: boolean;
}

function buildStaircases(calib: Calibration): Record<number, Staircase> {
  const out: Record<number, Staircase> = {};
  for (const f of CSF_FREQUENCIES_CPD) {
    const px = pxPerCycle(f, calib.viewing_distance_cm, calib.screen_ppi);
    out[f] = freshStaircase(f, px < 2.5);
  }
  return out;
}

function CsfPage() {
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);

  if (!profile.calibration) {
    return (
      <GateCalibration reason="공간 주파수(cpd) 자극은 화면 PPI · 시청 거리에 따라 계산됩니다." />
    );
  }

  return <CsfFlow calib={profile.calibration} onUpdate={update} />;
}

export default CsfPage;

function CsfFlow({
  calib,
  onUpdate,
}: {
  calib: Calibration;
  onUpdate: (u: (p: import('@/types/profile').VCDProfile) => import('@/types/profile').VCDProfile) => void;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [eye, setEye] = useState<Eye>('od');
  const [orderIdx, setOrderIdx] = useState<0 | 1>(0);
  const [paused, setPaused] = useState(false);
  const [staircases, setStaircases] = useState<Record<number, Staircase>>(() =>
    buildStaircases(calib),
  );
  const [trial, setTrial] = useState<Trial | null>(null);
  const [results, setResults] = useState<{ od: EyeResult | null; os: EyeResult | null }>({
    od: null,
    os: null,
  });

  const navigate = useNavigate();
  const feedbackTimer = useRef<number | null>(null);

  // 새 trial 선택
  const pickNextTrial = useCallback(
    (scs: Record<number, Staircase>): Trial | null => {
      const remaining = CSF_FREQUENCIES_CPD.filter((f) => !scs[f].finalized);
      if (remaining.length === 0) return null;
      const cpd = remaining[Math.floor(Math.random() * remaining.length)];
      return {
        cpd,
        contrast: scs[cpd].contrast,
        gratingSide: Math.random() < 0.5 ? 'left' : 'right',
        startTs: performance.now(),
        awaiting: true,
      };
    },
    [],
  );

  const finalize = useCallback(
    (scs: Record<number, Staircase>, partial: boolean) => {
      const r = aggregateEyeResult(scs, partial);
      setResults((prev) => ({ ...prev, [eye]: r }));
      onUpdate((p) => ({
        ...p,
        csf_curve: {
          od: eye === 'od' ? toStoredEye(r) : p.csf_curve?.od,
          os: eye === 'os' ? toStoredEye(r) : p.csf_curve?.os,
          tested_at: new Date().toISOString(),
        },
      }));
      setPhase('test_preview');
    },
    [eye, onUpdate],
  );

  const respond = useCallback(
    (side: 'left' | 'right' | 'dontknow') => {
      if (!trial || !trial.awaiting || paused) return;
      const correct = side !== 'dontknow' && side === trial.gratingSide;
      setTrial({ ...trial, awaiting: false });
      const sc = staircases[trial.cpd];
      const updated = staircaseStep(sc, correct);
      const newScs = { ...staircases, [trial.cpd]: updated };
      setStaircases(newScs);

      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = window.setTimeout(() => {
        const next = pickNextTrial(newScs);
        if (!next) {
          finalize(newScs, false);
        } else {
          setTrial(next);
        }
      }, FEEDBACK_MS);
    },
    [trial, paused, staircases, pickNextTrial, finalize],
  );

  // 키보드
  useEffect(() => {
    if (phase !== 'test') return;
    const onKey = (e: KeyboardEvent) => {
      if (!trial || !trial.awaiting) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        respond('left');
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        respond('right');
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, trial, respond]);

  // cleanup feedback timer on unmount
  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    [],
  );

  const startTest = () => {
    const fresh = buildStaircases(calib);
    setStaircases(fresh);
    setResults((prev) => ({ ...prev, [eye]: null }));
    setPhase('test');
    setPaused(false);
    setTrial(pickNextTrial(fresh));
  };

  const limitedFreqs = useMemo(
    () => CSF_FREQUENCIES_CPD.filter((f) => staircases[f].screenLimited),
    [staircases],
  );

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">대비 민감도 (CSF) 검사</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {phase === 'combined' ? '종합 결과' : eyeLabel(eye)}
        </span>
      </header>

      {phase === 'intro' && (
        <IntroPhase
          eye={eye}
          otherDone={results[eye === 'od' ? 'os' : 'od'] !== null}
          limitedFreqs={limitedFreqs}
          onStart={startTest}
        />
      )}

      {phase === 'test' && trial && (
        <TestPhase
          trial={trial}
          staircases={staircases}
          paused={paused}
          calib={calib}
          onRespond={respond}
          onPause={() => setPaused(true)}
          onResume={() => {
            setPaused(false);
            if (!trial) setTrial(pickNextTrial(staircases));
          }}
          onQuit={() => {
            if (!window.confirm('지금까지 측정된 주파수만 저장하고 종료하시겠습니까?')) return;
            finalize(staircases, true);
          }}
        />
      )}

      {phase === 'test_preview' && results[eye] && (
        <PreviewPhase
          eye={eye}
          result={results[eye]!}
          onRedo={startTest}
          onNext={() => {
            if (orderIdx === 0) {
              setOrderIdx(1);
              setEye('os');
              setStaircases(buildStaircases(calib));
              setPhase('intro');
            } else {
              setPhase('combined');
            }
          }}
        />
      )}

      {phase === 'combined' && (
        <CombinedPhase
          results={results}
          onRedo={() => {
            setResults({ od: null, os: null });
            setEye('od');
            setOrderIdx(0);
            setStaircases(buildStaircases(calib));
            setPhase('intro');
          }}
          onSave={() => {
            onUpdate((p) => ({
              ...p,
              csf_curve: {
                od: results.od ? toStoredEye(results.od) : undefined,
                os: results.os ? toStoredEye(results.os) : undefined,
                tested_at: new Date().toISOString(),
              },
            }));
          }}
          onProfile={() => navigate(ROUTES.profile)}
        />
      )}
    </div>
  );
}

function toStoredEye(r: EyeResult): CSFEye {
  return {
    freqs: r.freqs,
    thresholds: r.thresholds,
    sensitivities: r.sensitivities,
    reversals_used: r.reversals_used.map((arr) => arr.length),
    screen_limited: r.screen_limited,
    confidence: r.confidence,
    classification:
      r.classification && r.classification.category !== 'no_data'
        ? r.classification.category
        : null,
    partial: r.partial,
  };
}

function eyeLabel(e: Eye): string {
  return e === 'od' ? '오른쪽 눈 (OD)' : '왼쪽 눈 (OS)';
}

// ── Intro ─────────────────────────────────────────────
function IntroPhase({
  eye,
  otherDone,
  limitedFreqs,
  onStart,
}: {
  eye: Eye;
  otherDone: boolean;
  limitedFreqs: number[];
  onStart: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">{eyeLabel(eye)} 검사 준비</h3>
      <p className="mb-2 text-text">
        <strong>{eye === 'od' ? '왼쪽' : '오른쪽'}</strong> 눈을 손바닥으로 가린 채로 진행합니다.
      </p>
      <p className="mb-3 text-sm text-text-dim">
        {otherDone
          ? '두 번째 눈 — 마지막 검사입니다.'
          : '첫 번째 눈 — 두 눈 순서대로 검사합니다.'}
      </p>
      <ol className="mb-4 ml-5 list-decimal space-y-1 text-sm text-text">
        <li>좌우 두 개의 회색 박스가 표시됩니다.</li>
        <li>한쪽에 미세한 사인 격자, 다른 쪽은 균일한 회색입니다.</li>
        <li>줄무늬가 있는 쪽을 ← → (또는 A/L) 키 또는 버튼으로 응답하세요.</li>
        <li>안 보이면 추측해도 됩니다 — 우연 정답률 50%.</li>
      </ol>
      {limitedFreqs.length > 0 && (
        <p className="mb-3 text-xs text-warn">
          ※ 화면 해상도 한계로 {limitedFreqs.join(', ')} cpd 주파수는 자동 생략됩니다.
        </p>
      )}
      <button
        type="button"
        onClick={onStart}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
      >
        검사 시작 →
      </button>
    </section>
  );
}

// ── Test ──────────────────────────────────────────────
function TestPhase({
  trial,
  staircases,
  paused,
  calib,
  onRespond,
  onPause,
  onResume,
  onQuit,
}: {
  trial: Trial;
  staircases: Record<number, Staircase>;
  paused: boolean;
  calib: Calibration;
  onRespond: (side: 'left' | 'right' | 'dontknow') => void;
  onPause: () => void;
  onResume: () => void;
  onQuit: () => void;
}) {
  const finalizedCount = CSF_FREQUENCIES_CPD.filter((f) => staircases[f].finalized).length;
  // 전체 trial 누적치 — interleaved staircase는 주파수가 매번 랜덤이라
  // 주파수별 카운터를 보여주면 값이 들쭉날쭉 줄어드는 것처럼 보임.
  // 전체 누적치는 monotone-increase 보장.
  const totalTrials = CSF_FREQUENCIES_CPD.reduce(
    (s, f) => s + (staircases[f]?.trials.length ?? 0),
    0,
  );
  const totalMax = MAX_TRIALS_PER_FREQ * CSF_FREQUENCIES_CPD.length;

  return (
    <section className="relative rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
        <div>
          수렴 <strong className="text-text">{finalizedCount}</strong>
          <span className="text-text-dim">/{CSF_FREQUENCIES_CPD.length} 주파수</span>
          <span className="ml-2 text-text-dim">
            (전체{' '}
            <strong className="text-text">
              {Math.round((finalizedCount / CSF_FREQUENCIES_CPD.length) * 100)}%
            </strong>
            )
          </span>
        </div>
        <div className="font-mono text-text-dim">
          <span className="text-text">{trial.cpd.toFixed(1)}</span> cpd ·{' '}
          <span className="text-text">{totalTrials + 1}</span>/{totalMax}회
        </div>
      </div>

      {/* 격자 박스 × 2 — 가용 폭에 맞춰 BOX_PX_MIN~MAX 사이로 자동 조절.
          픽셀-사이클 비율(cpd)은 drawGrating에서 calib 기반으로 계산되므로
          박스 크기를 줄여도 cycles-per-degree 정확도는 유지됨. */}
      <div className="mb-4 flex items-center justify-center gap-3">
        <GratingBox cpd={trial.cpd} contrast={trial.contrast} side="left" trial={trial} calib={calib} />
        <span className="text-2xl text-text-dim">+</span>
        <GratingBox cpd={trial.cpd} contrast={trial.contrast} side="right" trial={trial} calib={calib} />
      </div>

      <p className="mb-3 text-center text-sm text-text-dim">어느 쪽에 줄무늬가 있나요?</p>

      <div className="mb-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => onRespond('left')}
          className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          ← 왼쪽 (A)
        </button>
        <button
          type="button"
          onClick={() => onRespond('dontknow')}
          className="rounded-md border border-line bg-bg-elev-2 px-4 py-2 text-sm hover:border-accent"
        >
          잘 모름
        </button>
        <button
          type="button"
          onClick={() => onRespond('right')}
          className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          오른쪽 (L) →
        </button>
      </div>

      <FreqProgressGrid staircases={staircases} activeCpd={trial.cpd} />

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onPause}
          disabled={paused}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
        >
          일시정지
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          종료 (부분 저장)
        </button>
      </div>

      {paused && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="rounded-md border border-line bg-bg-elev p-5 shadow-lg">
            <h4 className="mb-2 text-lg font-semibold text-text">일시정지됨</h4>
            <p className="mb-4 text-sm text-text-dim">검사를 이어가거나 부분 저장 후 종료할 수 있습니다.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onResume}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
              >
                이어하기
              </button>
              <button
                type="button"
                onClick={onQuit}
                className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
              >
                종료 (부분 저장)
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function GratingBox({
  cpd,
  contrast,
  side,
  trial,
  calib,
}: {
  cpd: number;
  contrast: number;
  side: 'left' | 'right';
  trial: Trial;
  calib: Calibration;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState(BOX_PX_MAX);

  // 컨테이너 폭에 맞춰 박스 크기를 BOX_PX_MIN~MAX로 적응
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setSize(Math.max(BOX_PX_MIN, Math.min(BOX_PX_MAX, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (trial.gratingSide === side) {
      drawGrating(ctx, size, cpd, contrast, calib);
    } else {
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(0, 0, size, size);
    }
  }, [size, cpd, contrast, side, trial.gratingSide, calib]);

  return (
    <div
      ref={wrapRef}
      className="aspect-square w-full max-w-[240px] flex-1 rounded-md border border-line bg-black p-1"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function drawGrating(
  ctx: CanvasRenderingContext2D,
  N: number,
  cpd: number,
  contrast: number,
  calib: Calibration,
) {
  const img = ctx.createImageData(N, N);
  const data = img.data;
  const pxPerCyc = pxPerCycle(cpd, calib.viewing_distance_cm, calib.screen_ppi);
  const k = (2 * Math.PI) / pxPerCyc;
  const halfC = contrast * 0.5;
  for (let x = 0; x < N; x++) {
    const v = 0.5 + halfC * Math.cos(k * (x - N / 2));
    const g = Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let y = 0; y < N; y++) {
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function FreqProgressGrid({
  staircases,
  activeCpd,
}: {
  staircases: Record<number, Staircase>;
  activeCpd: number | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-7">
      {CSF_FREQUENCIES_CPD.map((f) => {
        const sc = staircases[f];
        let cls = 'border-line bg-bg-elev-2 text-text-dim';
        if (sc.screenLimited) cls = 'border-warn/40 bg-warn/5 text-warn';
        else if (sc.finalized) cls = 'border-ok/40 bg-ok/10 text-ok';
        else if (f === activeCpd) cls = 'border-accent bg-accent/10 text-accent';
        else if (sc.trials.length > 0) cls = 'border-line bg-bg-elev-2 text-text';
        const pct = Math.min(100, (sc.reversals.length / REVERSALS_NEEDED) * 100);
        return (
          <div key={f} className={['rounded-md border p-1.5 text-xs', cls].join(' ')}>
            <div className="flex justify-between font-mono">
              <span>{f}</span>
              <span>{sc.screenLimited ? '한계' : `${sc.reversals.length}/${REVERSALS_NEEDED}`}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-bg">
              <div className="h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Preview / combined ────────────────────────────────
function PreviewPhase({
  eye,
  result,
  onRedo,
  onNext,
}: {
  eye: Eye;
  result: EyeResult;
  onRedo: () => void;
  onNext: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text">{eyeLabel(eye)} CSF 결과</h3>
        {result.partial && (
          <span className="rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs text-warn">
            부분 측정
          </span>
        )}
      </div>
      <div className="mb-3 rounded-md border border-line bg-bg-elev-2 p-3">
        <CSFChart
          datasets={[{ label: eye.toUpperCase(), sensitivities: result.sensitivities, color: '#6ea8ff' }]}
        />
        <p className="mt-2 text-xs text-text-dim">
          회색 띠 = 정상 범위 ±1σ (Pelli & Bex 2013 등 문헌 종합). 색 점 = 사용자 측정값.
        </p>
      </div>
      <ClassificationCard cls={result.classification} />
      <p className="mt-3 text-sm text-text-dim">
        신뢰도: <span className="font-mono text-text">{Math.round(result.confidence * 100)}%</span>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onRedo}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          이 눈 다시
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          다음 →
        </button>
      </div>
    </section>
  );
}

function CombinedPhase({
  results,
  onRedo,
  onSave,
  onProfile,
}: {
  results: { od: EyeResult | null; os: EyeResult | null };
  onRedo: () => void;
  onSave: () => void;
  onProfile: () => void;
}) {
  const datasets = [];
  if (results.od)
    datasets.push({ label: 'OD', sensitivities: results.od.sensitivities, color: '#6ea8ff' });
  if (results.os)
    datasets.push({ label: 'OS', sensitivities: results.os.sensitivities, color: '#9b8cff' });

  let combined: ClassificationResult | null = results.od?.classification ?? null;
  if (
    results.os?.classification &&
    severityRank(results.os.classification.category) > severityRank(combined?.category ?? 'normal')
  ) {
    combined = results.os.classification;
  }

  const conf = (((results.od?.confidence ?? 0) + (results.os?.confidence ?? 0)) / 2) * 100;

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">CSF 종합 결과</h3>
      <div className="mb-3 rounded-md border border-line bg-bg-elev-2 p-3">
        <CSFChart datasets={datasets} />
      </div>
      <ClassificationCard cls={combined} />
      <p className="mt-3 text-sm text-text-dim">
        전체 신뢰도: <span className="font-mono text-text">{Math.round(conf)}%</span>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onRedo}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          전체 다시
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          프로파일에 저장
        </button>
        <button
          type="button"
          onClick={onProfile}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          프로파일 보기 →
        </button>
      </div>
    </section>
  );
}

function ClassificationCard({ cls }: { cls: ClassificationResult | null }) {
  if (!cls) return null;
  return (
    <div className="rounded-md border border-line bg-bg-elev-2 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={[
            'rounded-md border px-2 py-0.5 text-xs font-semibold',
            cls.flagged
              ? 'border-err/40 bg-err/10 text-err'
              : 'border-line bg-bg text-text',
          ].join(' ')}
        >
          {cls.label}
        </span>
      </div>
      <p className="mb-2 text-sm text-text">{cls.clinicalNote}</p>
      <p className="text-xs text-text-dim">
        ⓘ 스크리닝 도구이며 의료 진단이 아닙니다. 검사 결과는 안과 전문의 진료를 대체하지 않습니다.
      </p>
    </div>
  );
}

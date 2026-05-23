import { useEffect, useReducer, useRef } from 'react';

import { useNavigate } from 'react-router-dom';

import GateCalibration from '@/components/GateCalibration';
import { ROUTES } from '@/constants/routes';
import { diopterToBlurPx, logmarToPx } from '@/features/vcd/optics';
import { useProfileStore } from '@/store/profileStore';
import type { Calibration, Eye, EyeRefraction } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   RefractionPage — Stage A (defocus staircase) + Stage B (fan chart).
   원본: refraction-test.js + page-refraction template.

   상태머신:
     gate → intro(eye) → A(eye) → A_preview(eye) → B(eye) → B_preview(eye)
     → (next eye intro 또는 combined)
   ───────────────────────────────────────────────────────── */

const TEST_LOGMAR = 0.5;

const STAGE_A_ROUNDS: { center: number | null; half: number; step: number }[] = [
  { center: 0, half: 3, step: 1.0 },
  { center: null, half: 1, step: 0.5 },
  { center: null, half: 0.5, step: 0.25 },
];

const FAN_ANGLES_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
const CYL_FROM_SCORE: Record<number, number> = {
  1: 0.0,
  2: -0.25,
  3: -0.5,
  4: -1.0,
  5: -2.0,
};

type Phase = 'intro' | 'A' | 'A_preview' | 'B' | 'B_preview' | 'combined';

interface EyeResult {
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  confidence: number;
}

interface StageAHistory {
  round: number;
  center: number;
  levels: number[];
  selected: number;
}

interface State {
  phase: Phase;
  eye: Eye;
  orderIdx: 0 | 1;
  signPrior: -1 | 0 | 1;
  results: { od: EyeResult; os: EyeResult };
  a: { round: number; history: StageAHistory[]; finalLevel: number | null } | null;
  b: { axis: number | null; perpScore: number | null };
}

function freshState(): State {
  return {
    phase: 'intro',
    eye: 'od',
    orderIdx: 0,
    signPrior: 0,
    results: {
      od: { sph: null, cyl: null, axis: null, confidence: 0 },
      os: { sph: null, cyl: null, axis: null, confidence: 0 },
    },
    a: null,
    b: { axis: null, perpScore: null },
  };
}

type Action =
  | { type: 'set_sign'; sign: -1 | 0 | 1 }
  | { type: 'start_A' }
  | { type: 'pick_A'; level: number }
  | { type: 'redo_A' }
  | { type: 'start_B' }
  | { type: 'pick_axis'; axis: number }
  | { type: 'pick_score'; score: number }
  | { type: 'confirm_B' }
  | { type: 'redo_B' }
  | { type: 'next_eye' }
  | { type: 'reset' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set_sign':
      return { ...state, signPrior: action.sign };
    case 'start_A':
      return {
        ...state,
        phase: 'A',
        a: { round: 0, history: [], finalLevel: null },
      };
    case 'redo_A':
      return {
        ...state,
        phase: 'A',
        a: { round: 0, history: [], finalLevel: null },
      };
    case 'pick_A': {
      const a = state.a;
      if (!a) return state;
      const rIdx = a.round;
      const rCfg = STAGE_A_ROUNDS[rIdx];
      const center =
        rCfg.center === null ? a.history[rIdx - 1].selected : rCfg.center;
      const levels = buildLevels(center, rCfg.half, rCfg.step);
      const history = [...a.history, { round: rIdx, center, levels, selected: action.level }];
      if (rIdx < STAGE_A_ROUNDS.length - 1) {
        return { ...state, a: { round: rIdx + 1, history, finalLevel: null } };
      }
      // final
      const finalLevel = action.level;
      const sign = state.signPrior !== 0 ? state.signPrior : -1;
      const magnitude = Math.abs(finalLevel);
      const sph = magnitude === 0 ? 0 : sign * magnitude;
      const isEdge = finalLevel === levels[0] || finalLevel === levels[levels.length - 1];
      const conf = (isEdge ? 0.55 : 0.85) * (state.signPrior !== 0 ? 1.0 : 0.7);
      const next = {
        ...state,
        phase: 'A_preview' as const,
        a: { round: rIdx, history, finalLevel },
      };
      next.results = {
        ...state.results,
        [state.eye]: {
          ...state.results[state.eye],
          sph: round2(sph),
          confidence: conf,
        },
      };
      return next;
    }
    case 'start_B':
      return { ...state, phase: 'B', b: { axis: null, perpScore: null } };
    case 'pick_axis':
      return { ...state, b: { ...state.b, axis: action.axis } };
    case 'pick_score':
      return { ...state, b: { ...state.b, perpScore: action.score } };
    case 'confirm_B': {
      if (state.b.axis === null || state.b.perpScore === null) return state;
      const cyl = CYL_FROM_SCORE[state.b.perpScore];
      const cylConf =
        state.b.perpScore === 1 ? 0.9 : state.b.perpScore >= 3 ? 0.85 : 0.7;
      const cur = state.results[state.eye];
      const next: State = {
        ...state,
        phase: 'B_preview',
        results: {
          ...state.results,
          [state.eye]: {
            ...cur,
            cyl,
            axis: state.b.axis,
            confidence: (cur.confidence + cylConf) / 2,
          },
        },
      };
      return next;
    }
    case 'redo_B':
      return { ...state, phase: 'B', b: { axis: null, perpScore: null } };
    case 'next_eye':
      if (state.orderIdx === 0) {
        return {
          ...state,
          orderIdx: 1,
          eye: 'os',
          phase: 'intro',
          a: null,
          b: { axis: null, perpScore: null },
        };
      }
      return { ...state, phase: 'combined' };
    case 'reset':
      return freshState();
  }
}

function buildLevels(center: number, half: number, step: number): number[] {
  const out: number[] = [];
  for (let v = center - half; v <= center + half + 1e-6; v += step) {
    out.push(round2(v));
  }
  return out;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function eyeLabel(e: Eye): string {
  return e === 'od' ? '오른쪽 눈 (OD)' : '왼쪽 눈 (OS)';
}

function coverLabel(e: Eye): string {
  return e === 'od' ? '왼쪽' : '오른쪽';
}

function avgConfidence(r: { od: EyeResult; os: EyeResult }): number {
  const vs = [r.od.confidence, r.os.confidence].filter((v) => v > 0);
  if (!vs.length) return 0;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

function RefractionPage() {
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);
  const [state, dispatch] = useReducer(reducer, undefined, freshState);

  // 매 상태 변경 시 증분 저장 (원본도 그렇게 함)
  useEffect(() => {
    if (state.phase !== 'A_preview' && state.phase !== 'B_preview') return;
    const eye = state.eye;
    const r = state.results[eye];
    update((p) => ({
      ...p,
      refraction: {
        od: toEyeRef(p.refraction?.od, eye === 'od' ? r : null),
        os: toEyeRef(p.refraction?.os, eye === 'os' ? r : null),
        confidence: avgConfidence(state.results),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.results.od.sph, state.results.od.cyl, state.results.os.sph, state.results.os.cyl]);

  if (!profile.calibration) {
    return <GateCalibration reason="굴절 검사 자극의 픽셀 크기는 화면 PPI · 시청 거리로 계산됩니다." />;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">굴절 추정</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {state.phase === 'combined' ? '종합 결과' : eyeLabel(state.eye)}
        </span>
      </header>

      {state.phase === 'intro' && <IntroPhase state={state} dispatch={dispatch} />}
      {state.phase === 'A' && (
        <StageAPhase state={state} dispatch={dispatch} calib={profile.calibration} />
      )}
      {state.phase === 'A_preview' && <StageAPreview state={state} dispatch={dispatch} />}
      {state.phase === 'B' && (
        <StageBPhase state={state} dispatch={dispatch} calib={profile.calibration} />
      )}
      {state.phase === 'B_preview' && <StageBPreview state={state} dispatch={dispatch} />}
      {state.phase === 'combined' && (
        <CombinedPhase state={state} dispatch={dispatch} onSave={update} />
      )}
    </div>
  );
}

export default RefractionPage;

function toEyeRef(
  prev: EyeRefraction | undefined,
  data: EyeResult | null,
): EyeRefraction {
  // 어느 한 필드라도 들어오면 기존 값에 머지. 둘 다 없으면 0으로 폴백.
  const base: EyeRefraction = prev ?? { sph: 0, cyl: 0, axis: 0 };
  if (!data) return base;
  return {
    sph: data.sph ?? base.sph,
    cyl: data.cyl ?? base.cyl,
    axis: data.axis ?? base.axis,
  };
}

// ── Intro ──────────────────────────────────────────────
function IntroPhase({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const askSign = state.orderIdx === 0;
  const otherDone = state.results[state.eye === 'od' ? 'os' : 'od'].sph !== null;
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">{eyeLabel(state.eye)} 검사 준비</h3>
      <p className="mb-2 text-text">
        <strong>{coverLabel(state.eye)}</strong> 눈을 손바닥으로 가린 채로 진행합니다.
      </p>
      <p className="mb-4 text-sm text-text-dim">
        {otherDone ? '두 번째 눈 — 마지막 단계입니다.' : '첫 번째 눈 — 두 단계 검사를 진행합니다.'}
      </p>

      {askSign && (
        <div className="mb-5 rounded-md border border-line bg-bg-elev-2 p-3">
          <div className="mb-2 text-sm font-semibold text-text">평소 안경/렌즈 종류</div>
          <p className="mb-2 text-xs text-text-dim">
            SPH 부호 결정에 사용됩니다. 미지정 시 근시(-)로 가정합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <SignButton selected={state.signPrior === -1} onClick={() => dispatch({ type: 'set_sign', sign: -1 })}>
              근시 (먼 곳 흐림)
            </SignButton>
            <SignButton selected={state.signPrior === 1} onClick={() => dispatch({ type: 'set_sign', sign: 1 })}>
              원시/노안 (가까운 곳 흐림)
            </SignButton>
            <SignButton selected={state.signPrior === 0} onClick={() => dispatch({ type: 'set_sign', sign: 0 })}>
              모름
            </SignButton>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => dispatch({ type: 'start_A' })}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
      >
        검사 시작 →
      </button>
    </section>
  );
}

function SignButton({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md border px-3 py-1.5 text-sm',
        selected ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-bg text-text hover:border-accent',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── Stage A: defocus staircase ────────────────────────
function StageAPhase({
  state,
  dispatch,
  calib,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  calib: Calibration;
}) {
  const a = state.a!;
  const rIdx = a.round;
  const rCfg = STAGE_A_ROUNDS[rIdx];
  const center = rCfg.center === null ? a.history[rIdx - 1].selected : rCfg.center;
  const levels = buildLevels(center, rCfg.half, rCfg.step);

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-text">
          단계 A — Defocus staircase ({rIdx + 1}/3)
        </h3>
        <span className="text-xs text-text-dim">
          ±{rCfg.half}D 범위, {rCfg.step}D 간격 ({levels.length}개)
        </span>
      </div>
      <p className="mb-4 text-sm text-text-dim">
        가장 <strong>또렷하게 보이는</strong> 글자를 클릭하세요.
      </p>

      <div className="mb-4 flex flex-wrap justify-center gap-3">
        {levels.map((level) => (
          <BlurredLetterCard
            key={level}
            level={level}
            calib={calib}
            onPick={() => dispatch({ type: 'pick_A', level })}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => dispatch({ type: 'redo_A' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          처음부터 다시
        </button>
      </div>
    </section>
  );
}

function BlurredLetterCard({
  level,
  calib,
  onPick,
}: {
  level: number;
  calib: Calibration;
  onPick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const letterPx = logmarToPx(TEST_LOGMAR, calib.viewing_distance_cm, calib.screen_ppi);
    const maxSigma = diopterToBlurPx(3, calib.viewing_distance_cm, calib.screen_ppi);
    const cardPx = Math.ceil(letterPx + 8 * maxSigma);
    cv.style.width = cardPx + 'px';
    cv.style.height = cardPx + 'px';
    cv.width = cardPx * dpr;
    cv.height = cardPx * dpr;
    drawBlurredE(
      cv,
      letterPx * dpr,
      diopterToBlurPx(level, calib.viewing_distance_cm, calib.screen_ppi) * dpr,
    );
  }, [level, calib]);

  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-col items-center gap-1 rounded-md border border-line bg-black p-2 hover:border-accent"
    >
      <canvas ref={canvasRef} />
      <span className="font-mono text-xs text-text-dim">
        {(level > 0 ? '+' : '') + level.toFixed(2)}D
      </span>
    </button>
  );
}

function drawBlurredE(canvas: HTMLCanvasElement, letterPx: number, blurPx: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.filter = blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : 'none';
  ctx.fillStyle = '#fff';
  const x = (canvas.width - letterPx) / 2;
  const y = (canvas.height - letterPx) / 2;
  const u = letterPx / 5;
  ctx.fillRect(x, y, letterPx, u);
  ctx.fillRect(x, y + 2 * u, letterPx, u);
  ctx.fillRect(x, y + 4 * u, letterPx, u);
  ctx.fillRect(x, y, u, letterPx);
  ctx.restore();
}

function StageAPreview({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const r = state.results[state.eye];
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">단계 A 결과 ({eyeLabel(state.eye)})</h3>
      <KV>
        <K>SPH</K>
        <V>
          {r.sph === null
            ? '--'
            : `${r.sph > 0 ? '+' : ''}${r.sph.toFixed(2)} D`}
        </V>
        <K>신뢰도</K>
        <V>{Math.round(r.confidence * 100)}%</V>
      </KV>
      {state.signPrior === 0 && (
        <p className="mt-2 text-xs text-warn">
          ⚠️ 안경 사용 유형 미지정 — 부호는 근시(-)로 가정했습니다.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'redo_A' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          단계 A 다시
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'start_B' })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          단계 B (난시) →
        </button>
      </div>
    </section>
  );
}

// ── Stage B: fan chart ────────────────────────────────
function StageBPhase({
  state,
  dispatch,
  calib,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  calib: Calibration;
}) {
  const fanRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = fanRef.current;
    if (!cv) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const css = 320;
    cv.style.width = css + 'px';
    cv.style.height = css + 'px';
    cv.width = css * dpr;
    cv.height = css * dpr;
    drawFan(cv, dpr, state.b.axis);
  }, [state.b.axis]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = fanRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const r = Math.hypot(x, y);
    if (r < 20 || r > rect.width / 2) return;
    const angDeg = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 180;
    let best = FAN_ANGLES_DEG[0];
    let bestDist = 999;
    for (const a of FAN_ANGLES_DEG) {
      const d = Math.min(Math.abs(angDeg - a), 180 - Math.abs(angDeg - a));
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    dispatch({ type: 'pick_axis', axis: best });
  };

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">단계 B — 난시 팬 차트</h3>
      <p className="mb-4 text-sm text-text-dim">
        가장 또렷하게 보이는 방향의 선을 클릭하세요. 모든 선이 비슷하면 가운데 부근을 선택해도
        됩니다.
      </p>

      <div className="mb-4 flex flex-col items-center gap-3">
        <canvas
          ref={fanRef}
          onClick={onCanvasClick}
          className="cursor-crosshair rounded-md border border-line"
        />
        {state.b.axis !== null && (
          <div className="text-sm text-text">
            선택한 축: <span className="font-mono text-accent">{state.b.axis}°</span>
          </div>
        )}
      </div>

      {state.b.axis !== null && (
        <div className="rounded-md border border-line bg-bg-elev-2 p-3">
          <p className="mb-2 text-sm text-text">
            선택한 축에 <strong>직교</strong>한 글자의 흐림 정도를 1~5로 평가하세요. 1 = 똑같이
            또렷, 5 = 훨씬 흐림.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => dispatch({ type: 'pick_score', score: s })}
                className={[
                  'h-9 w-12 rounded-md border text-sm font-semibold',
                  state.b.perpScore === s
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line bg-bg text-text hover:border-accent',
                ].join(' ')}
              >
                {s}
              </button>
            ))}
          </div>
          {state.b.perpScore !== null && (
            <div className="font-mono text-sm text-text-dim">
              CYL {CYL_FROM_SCORE[state.b.perpScore].toFixed(2)} D
            </div>
          )}
          <AxisPairPreview axisDeg={state.b.axis} calib={calib} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'redo_B' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          다시
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'confirm_B' })}
          disabled={state.b.axis === null || state.b.perpScore === null}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-text-dim"
        >
          확인 →
        </button>
      </div>
    </section>
  );
}

function AxisPairPreview({ axisDeg, calib }: { axisDeg: number; calib: Calibration }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = 280;
    const cssH = 100;
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    cv.width = cssW * dpr;
    cv.height = cssH * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const letterPx = logmarToPx(TEST_LOGMAR, calib.viewing_distance_cm, calib.screen_ppi);
    const drawBar = (cx: number, cy: number, deg: number, label: string) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-deg * Math.PI) / 180);
      ctx.fillStyle = '#e7ecf3';
      const w = letterPx * dpr * 3;
      const h = (letterPx * dpr) / 4;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      ctx.fillStyle = '#9aa3b2';
      ctx.font = `${11 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, cy + 36 * dpr);
    };
    drawBar(cv.width * 0.25, cv.height * 0.4, axisDeg, `선택 ${axisDeg}°`);
    drawBar(cv.width * 0.75, cv.height * 0.4, (axisDeg + 90) % 180, `직교 ${(axisDeg + 90) % 180}°`);
  }, [axisDeg, calib]);
  return <canvas ref={cvRef} className="mt-2" />;
}

function drawFan(canvas: HTMLCanvasElement, dpr: number, selectedDeg: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) * 0.45;
  const labelR = r + 14 * dpr;
  ctx.lineWidth = 4 * dpr;
  ctx.lineCap = 'round';
  ctx.font = `${12 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  FAN_ANGLES_DEG.forEach((deg) => {
    const rad = (-deg * Math.PI) / 180;
    const sel = deg === selectedDeg;
    ctx.strokeStyle = sel ? '#6ea8ff' : '#e7ecf3';
    const x1 = cx + Math.cos(rad) * 16 * dpr;
    const y1 = cy + Math.sin(rad) * 16 * dpr;
    const x2 = cx + Math.cos(rad) * r;
    const y2 = cy + Math.sin(rad) * r;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const x3 = cx - Math.cos(rad) * r;
    const y3 = cy - Math.sin(rad) * r;
    const x4 = cx - Math.cos(rad) * 16 * dpr;
    const y4 = cy - Math.sin(rad) * 16 * dpr;
    ctx.beginPath();
    ctx.moveTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.stroke();
    ctx.fillStyle = sel ? '#6ea8ff' : '#9aa3b2';
    ctx.fillText(deg + '°', cx + Math.cos(rad) * labelR, cy + Math.sin(rad) * labelR);
  });

  ctx.fillStyle = '#9aa3b2';
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

function StageBPreview({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const r = state.results[state.eye];
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">단계 B 결과 ({eyeLabel(state.eye)})</h3>
      <KV>
        <K>CYL</K>
        <V>{r.cyl === null ? '--' : `${r.cyl.toFixed(2)} D`}</V>
        <K>AXIS</K>
        <V>{r.axis === null ? '--' : `${r.axis}°`}</V>
        <K>신뢰도</K>
        <V>{Math.round(r.confidence * 100)}%</V>
      </KV>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'redo_B' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          단계 B 다시
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'next_eye' })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          {state.orderIdx === 0 ? '다음 눈 →' : '결과 보기 →'}
        </button>
      </div>
    </section>
  );
}

function CombinedPhase({
  state,
  dispatch,
  onSave,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onSave: ReturnType<typeof useProfileStore.getState>['update'] | ((u: (p: import('@/types/profile').VCDProfile) => import('@/types/profile').VCDProfile) => void);
}) {
  const navigate = useNavigate();
  const conf = avgConfidence(state.results);
  const handleSave = () => {
    onSave((p) => ({
      ...p,
      refraction: {
        od: toEyeRef(p.refraction?.od, state.results.od),
        os: toEyeRef(p.refraction?.os, state.results.os),
        confidence: conf,
      },
    }));
  };
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">굴절 종합 결과</h3>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <EyeCard eye="od" data={state.results.od} />
        <EyeCard eye="os" data={state.results.os} />
      </div>
      <p className="mb-4 text-sm text-text-dim">
        전체 신뢰도: <span className="font-mono text-text">{Math.round(conf * 100)}%</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'reset' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          전체 다시
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          프로파일에 저장
        </button>
        <button
          type="button"
          onClick={() => navigate(ROUTES.profile)}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          프로파일 보기 →
        </button>
      </div>
    </section>
  );
}

function EyeCard({ eye, data }: { eye: Eye; data: EyeResult }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev-2 p-3">
      <div className="mb-2 text-sm font-semibold text-text">{eyeLabel(eye)}</div>
      <KV>
        <K>SPH</K>
        <V>
          {data.sph === null
            ? '--'
            : `${data.sph > 0 ? '+' : ''}${data.sph.toFixed(2)}`}
        </V>
        <K>CYL</K>
        <V>{data.cyl === null ? '--' : data.cyl.toFixed(2)}</V>
        <K>AXIS</K>
        <V>{data.axis === null ? '--' : `${data.axis}°`}</V>
      </KV>
    </div>
  );
}

// ── Tiny KV components ────────────────────────────────
function KV({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">{children}</dl>;
}
function K({ children }: { children: React.ReactNode }) {
  return <dt className="text-text-dim">{children}</dt>;
}
function V({ children }: { children: React.ReactNode }) {
  return <dd className="font-mono text-text">{children}</dd>;
}


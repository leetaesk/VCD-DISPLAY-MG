import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useNavigate } from 'react-router-dom';

import GateCalibration from '@/components/GateCalibration';
import { ROUTES, SLOAN_LETTERS } from '@/constants';
import { logmarToPx, logmarToSnellen } from '@/features/vcd/optics';
import { useProfileStore } from '@/store/profileStore';
import type { Calibration, Eye, LogMAREye, VCDProfile } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   VisionPage — LogMAR ETDRS staircase.
   원본: vision-test.js + page-vision template.
   ───────────────────────────────────────────────────────── */

const LETTERS_PER_ROW = 5;
const PASS_THRESHOLD = 3;
const START_LOGMAR = 0.3;
const MIN_LOGMAR = -0.3;
const MAX_LOGMAR = 1.0;
const STAIRCASE_STEP = 0.1;
const PRESENT_MS = 300;
const MIN_RELIABLE_LETTER_PX = 5;

type Phase = 'intro' | 'test' | 'test_preview' | 'combined';

interface TrialHistory {
  logmar: number;
  correct: number;
  ms: number;
}

interface EyeResult {
  logmar: number | null;
  confidence: number;
  history: TrialHistory[];
  converged: boolean;
  screenLimited: boolean;
}

interface Staircase {
  currentLogMAR: number;
  visits: Record<string, number>;
  history: TrialHistory[];
  screenFloor: number;
}

interface Trial {
  letters: string[];
  input: string[];
  startTs: number;
}

interface State {
  phase: Phase;
  eye: Eye;
  orderIdx: 0 | 1;
  results: { od: EyeResult; os: EyeResult };
  staircase: Staircase | null;
  trial: Trial | null;
}

const EMPTY_EYE: EyeResult = {
  logmar: null,
  confidence: 0,
  history: [],
  converged: false,
  screenLimited: false,
};

function freshState(): State {
  return {
    phase: 'intro',
    eye: 'od',
    orderIdx: 0,
    results: { od: { ...EMPTY_EYE }, os: { ...EMPTY_EYE } },
    staircase: null,
    trial: null,
  };
}

function freshStaircase(screenFloor: number): Staircase {
  return {
    currentLogMAR: clamp(START_LOGMAR, screenFloor, MAX_LOGMAR),
    visits: {},
    history: [],
    screenFloor,
  };
}

function freshTrial(): Trial {
  const letters: string[] = [];
  for (let i = 0; i < LETTERS_PER_ROW; i++) {
    letters.push(SLOAN_LETTERS[Math.floor(Math.random() * SLOAN_LETTERS.length)]);
  }
  return { letters, input: [], startTs: performance.now() };
}

type Action =
  | { type: 'start_test'; screenFloor: number }
  | { type: 'next_trial' }
  | { type: 'set_input'; input: string[] }
  | { type: 'submit'; result: EyeResult | null; staircase?: Staircase }
  | { type: 'go_intro' }
  | { type: 'redo_eye'; screenFloor: number }
  | { type: 'advance_eye'; screenFloor: number }
  | { type: 'reset'; screenFloor: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start_test':
      return {
        ...state,
        phase: 'test',
        staircase: freshStaircase(action.screenFloor),
        trial: freshTrial(),
      };
    case 'next_trial':
      return { ...state, trial: freshTrial() };
    case 'set_input':
      if (!state.trial) return state;
      return { ...state, trial: { ...state.trial, input: action.input } };
    case 'submit': {
      // 새 staircase가 들어왔으면 갱신; result가 있으면 finishStaircase.
      if (action.result) {
        return {
          ...state,
          results: { ...state.results, [state.eye]: action.result },
          phase: 'test_preview',
        };
      }
      return {
        ...state,
        staircase: action.staircase ?? state.staircase,
        trial: freshTrial(),
      };
    }
    case 'go_intro':
      return { ...state, phase: 'intro' };
    case 'redo_eye':
      return {
        ...state,
        results: { ...state.results, [state.eye]: { ...EMPTY_EYE } },
        staircase: freshStaircase(action.screenFloor),
        trial: freshTrial(),
        phase: 'test',
      };
    case 'advance_eye':
      if (state.orderIdx === 0) {
        return {
          ...state,
          orderIdx: 1,
          eye: 'os',
          staircase: freshStaircase(action.screenFloor),
          trial: null,
          phase: 'intro',
        };
      }
      return { ...state, phase: 'combined' };
    case 'reset':
      return {
        ...freshState(),
        staircase: freshStaircase(action.screenFloor),
      };
  }
}

function VisionPage() {
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);
  const [state, dispatch] = useReducer(reducer, undefined, freshState);

  if (!profile.calibration) {
    return (
      <GateCalibration reason="시력 검사 자극의 픽셀 크기는 화면 PPI · 시청 거리로 계산됩니다." />
    );
  }

  const calib = profile.calibration;
  const screenFloor = currentScreenFloor(calib);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">LogMAR 시력 검사</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {state.phase === 'combined' ? '종합 결과' : eyeLabel(state.eye)}
        </span>
      </header>

      {state.phase === 'intro' && (
        <IntroPhase state={state} dispatch={dispatch} screenFloor={screenFloor} />
      )}
      {state.phase === 'test' && state.trial && state.staircase && (
        <TestPhase
          state={state}
          dispatch={dispatch}
          calib={calib}
          screenFloor={screenFloor}
          onPersistEye={(eye, r) =>
            update((p) => persistEye(p, eye, r))
          }
        />
      )}
      {state.phase === 'test_preview' && (
        <PreviewPhase
          state={state}
          dispatch={dispatch}
          profile={profile}
          screenFloor={screenFloor}
        />
      )}
      {state.phase === 'combined' && (
        <CombinedPhase
          state={state}
          dispatch={dispatch}
          screenFloor={screenFloor}
          onSave={() =>
            update((p) => ({
              ...p,
              logmar: {
                od:
                  state.results.od.logmar !== null
                    ? {
                        logmar: state.results.od.logmar,
                        confidence: state.results.od.confidence,
                        screen_limited: state.results.od.screenLimited,
                      }
                    : null,
                os:
                  state.results.os.logmar !== null
                    ? {
                        logmar: state.results.os.logmar,
                        confidence: state.results.os.confidence,
                        screen_limited: state.results.os.screenLimited,
                      }
                    : null,
              },
            }))
          }
        />
      )}
    </div>
  );
}

export default VisionPage;

function persistEye(p: VCDProfile, eye: Eye, r: EyeResult): VCDProfile {
  if (r.logmar === null) return p;
  const cur = p.logmar ?? { od: null, os: null };
  const slot: LogMAREye = {
    logmar: r.logmar,
    confidence: r.confidence,
    screen_limited: r.screenLimited,
  };
  return { ...p, logmar: { ...cur, [eye]: slot } };
}

function eyeLabel(e: Eye): string {
  return e === 'od' ? '오른쪽 눈 (OD)' : '왼쪽 눈 (OS)';
}

function coverLabel(e: Eye): string {
  return e === 'od' ? '왼쪽' : '오른쪽';
}

// ── Phases ────────────────────────────────────────────
function IntroPhase({
  state,
  dispatch,
  screenFloor,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  screenFloor: number;
}) {
  const otherDone = state.results[state.eye === 'od' ? 'os' : 'od'].logmar !== null;
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">{eyeLabel(state.eye)} 검사 준비</h3>
      <p className="mb-2 text-text">
        <strong>{coverLabel(state.eye)}</strong> 눈을 손바닥으로 가린 채로 진행합니다.
      </p>
      <p className="mb-3 text-sm text-text-dim">
        {otherDone ? '두 번째 눈 — 마지막 검사입니다.' : '첫 번째 눈 — 두 눈 순서대로 검사합니다.'}
      </p>
      <ol className="mb-4 ml-5 list-decimal space-y-1 text-sm text-text">
        <li>화면에 5개 Sloan 글자가 한 줄로 표시됩니다.</li>
        <li>읽은 순서대로 버튼을 누르거나 키보드로 입력합니다.</li>
        <li>잘 안 보여도 추측해 보세요 (우연 정답률 ~0.9%).</li>
        <li>안경/렌즈는 일관되게 (OD/OS 둘 다 같은 조건).</li>
      </ol>
      {screenFloor > 0.05 && (
        <p className="mb-3 text-xs text-warn">
          ※ 측정 가능 최소 LogMAR ≈ {screenFloor.toFixed(2)} (그보다 좋은 시력은 화면 해상도
          한계로 측정 불가).
        </p>
      )}
      <button
        type="button"
        onClick={() => dispatch({ type: 'start_test', screenFloor })}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
      >
        검사 시작 →
      </button>
    </section>
  );
}

function TestPhase({
  state,
  dispatch,
  calib,
  screenFloor,
  onPersistEye,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  calib: Calibration;
  screenFloor: number;
  onPersistEye: (eye: Eye, r: EyeResult) => void;
}) {
  const trial = state.trial!;
  const sc = state.staircase!;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 키보드 + 버튼 핸들러
  const addLetter = useCallback(
    (letter: string) => {
      if (trial.input.length >= LETTERS_PER_ROW) return;
      const next = [...trial.input, letter];
      dispatch({ type: 'set_input', input: next });
      if (next.length === LETTERS_PER_ROW) {
        window.setTimeout(() => doSubmit(next), PRESENT_MS);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trial],
  );

  const deleteLetter = useCallback(() => {
    if (trial.input.length === 0) return;
    dispatch({ type: 'set_input', input: trial.input.slice(0, -1) });
  }, [trial.input, dispatch]);

  const doSubmit = useCallback(
    (input: string[] = trial.input) => {
      let correct = 0;
      for (let i = 0; i < LETTERS_PER_ROW; i++) {
        if (input[i] && input[i].toUpperCase() === trial.letters[i]) correct++;
      }
      const hist: TrialHistory = {
        logmar: sc.currentLogMAR,
        correct,
        ms: performance.now() - trial.startTs,
      };
      const newHistory = [...sc.history, hist];
      const key = sc.currentLogMAR.toFixed(1);
      const newVisits = { ...sc.visits, [key]: (sc.visits[key] ?? 0) + 1 };

      // Convergence: same LogMAR visited twice
      let converged = newVisits[key] >= 2;
      let finalLogMAR = sc.currentLogMAR;
      let nextLogMAR = sc.currentLogMAR;
      if (!converged) {
        const direction = correct >= PASS_THRESHOLD ? +1 : -1;
        nextLogMAR = round1(sc.currentLogMAR + -direction * STAIRCASE_STEP);
        if (nextLogMAR < sc.screenFloor) {
          converged = true;
          finalLogMAR = round1(sc.screenFloor);
        } else if (nextLogMAR > MAX_LOGMAR) {
          converged = true;
          finalLogMAR = MAX_LOGMAR;
        }
      }

      if (converged) {
        const conf = computeConfidence(newHistory);
        const screenLimited = finalLogMAR <= sc.screenFloor + 0.05;
        const result: EyeResult = {
          logmar: round1(finalLogMAR),
          confidence: conf,
          history: newHistory,
          converged: true,
          screenLimited,
        };
        onPersistEye(state.eye, result);
        dispatch({ type: 'submit', result });
      } else {
        dispatch({
          type: 'submit',
          result: null,
          staircase: {
            ...sc,
            currentLogMAR: nextLogMAR,
            history: newHistory,
            visits: newVisits,
          },
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trial, sc, state.eye],
  );

  // 키보드 핸들러
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toUpperCase();
      if ((SLOAN_LETTERS as readonly string[]).includes(k)) {
        addLetter(k);
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        deleteLetter();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (trial.input.length > 0) doSubmit();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [addLetter, deleteLetter, doSubmit, trial.input.length]);

  // 글자 그리기
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const lm = sc.currentLogMAR;
    const letterPx = logmarToPx(lm, calib.viewing_distance_cm, calib.screen_ppi);
    const interLetter = letterPx * 1.0;
    const padding = letterPx * 0.5;
    const cssW = Math.max(
      240,
      padding * 2 + LETTERS_PER_ROW * letterPx + (LETTERS_PER_ROW - 1) * interLetter,
    );
    const cssH = Math.max(80, letterPx * 2);
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    cv.width = (cssW * dpr) | 0;
    cv.height = (cssH * dpr) | 0;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${letterPx * dpr}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const xStep = (letterPx + interLetter) * dpr;
    const xStart = (padding + letterPx / 2) * dpr;
    const y = cv.height / 2;
    trial.letters.forEach((L, i) => {
      ctx.fillText(L, xStart + i * xStep, y);
    });
  }, [trial.letters, sc.currentLogMAR, calib]);

  const inputDisplay = Array.from({ length: LETTERS_PER_ROW })
    .map((_, i) => trial.input[i] ?? '_')
    .join(' ');

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex flex-wrap gap-3 text-sm text-text-dim">
        <span>
          시도 <strong className="text-text">{sc.history.length + 1}</strong>
        </span>
        <span>·</span>
        <span>
          LogMAR{' '}
          <strong className="font-mono text-text">
            {(sc.currentLogMAR >= 0 ? '+' : '') + sc.currentLogMAR.toFixed(1)}
          </strong>
        </span>
        <span>·</span>
        <span className="font-mono">{logmarToSnellen(sc.currentLogMAR)}</span>
      </div>

      {/* 글자 캔버스는 PPI·시청거리 기반 mm로 그려지므로 축소 금지.
          모바일에서 폭 초과 시 가로 스크롤. */}
      <div className="mb-4 -mx-4 overflow-x-auto sm:mx-0">
        <div className="mx-4 flex justify-center rounded-md border border-line bg-white p-3 sm:mx-0">
          <canvas ref={canvasRef} />
        </div>
      </div>

      <div className="mb-3 text-center font-mono text-2xl tracking-[0.5em] text-text">
        {inputDisplay}
      </div>

      <div className="mb-4 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {SLOAN_LETTERS.map((L) => (
          <button
            key={L}
            type="button"
            onClick={() => addLetter(L)}
            className="min-h-11 rounded-md border border-line bg-bg-elev-2 py-3 font-mono text-lg text-text hover:border-accent"
          >
            {L}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={deleteLetter}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          ⌫ 지우기
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'set_input', input: ['', '', '', '', ''] });
            window.setTimeout(() => doSubmit(['', '', '', '', '']), 0);
          }}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          잘 안 보임
        </button>
        <button
          type="button"
          onClick={() => doSubmit()}
          disabled={trial.input.length === 0}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-bg hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-text-dim"
        >
          확인 ⏎
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => dispatch({ type: 'go_intro' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          중단
        </button>
      </div>

      <p className="mt-3 text-xs text-text-dim">
        키보드: 글자 입력 · Backspace 지우기 · Enter 확인. screenFloor=
        {screenFloor.toFixed(2)}
      </p>
    </section>
  );
}

function PreviewPhase({
  state,
  dispatch,
  profile,
  screenFloor,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  profile: VCDProfile;
  screenFloor: number;
}) {
  const r = state.results[state.eye];
  if (r.logmar === null) return null;
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">{eyeLabel(state.eye)} 결과</h3>
      <KV>
        <K>LogMAR</K>
        <V>{(r.logmar >= 0 ? '+' : '') + r.logmar.toFixed(2)}</V>
        <K>Snellen</K>
        <V>{logmarToSnellen(r.logmar)}</V>
        <K>신뢰도</K>
        <V>{Math.round(r.confidence * 100)}%</V>
        <K>시도</K>
        <V>{r.history.length}</V>
      </KV>
      {r.screenLimited && (
        <p className="mt-3 text-xs text-warn">
          ⚠️ 화면 해상도 한계에 도달했습니다 — 실제 시력은 더 좋을 수 있습니다.
        </p>
      )}
      <CrossCheck profile={profile} eye={state.eye} measured={r.logmar} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'redo_eye', screenFloor })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          이 눈 다시
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'advance_eye', screenFloor })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          {state.orderIdx === 0 ? '다음 눈 →' : '결과 보기 →'}
        </button>
      </div>
    </section>
  );
}

function CrossCheck({
  profile,
  eye,
  measured,
}: {
  profile: VCDProfile;
  eye: Eye;
  measured: number;
}) {
  const rx = profile.refraction?.[eye];
  if (!rx) {
    return (
      <p className="mt-3 text-xs text-text-dim">굴절 검사 결과가 없어 교차 검증을 건너뜁니다.</p>
    );
  }
  const sph = rx.sph;
  const expected = Math.abs(sph) * 0.1;
  const diff = measured - expected;
  const ok = Math.abs(diff) <= 0.3;
  return (
    <div className="mt-4 rounded-md border border-line bg-bg-elev-2 p-3">
      <h4 className="mb-2 text-sm font-semibold text-text">굴절 검사와 비교</h4>
      <KV>
        <K>SPH</K>
        <V>
          {(sph >= 0 ? '+' : '') + sph.toFixed(2)} D
        </V>
        <K>예상 LogMAR</K>
        <V>{expected.toFixed(2)} (|SPH| × 0.1)</V>
        <K>측정 LogMAR</K>
        <V>{measured.toFixed(2)}</V>
        <K>차이</K>
        <V>{(diff >= 0 ? '+' : '') + diff.toFixed(2)}</V>
      </KV>
      <p className={['mt-2 text-xs', ok ? 'text-ok' : 'text-warn'].join(' ')}>
        {ok
          ? '✓ 굴절 결과와 일관됩니다.'
          : '⚠️ 굴절 결과와 차이가 큽니다 (|Δ| > 0.3). 재측정을 권장합니다.'}
      </p>
    </div>
  );
}

function CombinedPhase({
  state,
  dispatch,
  screenFloor,
  onSave,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  screenFloor: number;
  onSave: () => void;
}) {
  const navigate = useNavigate();
  const conf = avgConfidence(state.results);
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">LogMAR 종합 결과</h3>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <EyeResultCard eye="od" data={state.results.od} />
        <EyeResultCard eye="os" data={state.results.os} />
      </div>
      <p className="mb-4 text-sm text-text-dim">
        전체 신뢰도: <span className="font-mono text-text">{Math.round(conf * 100)}%</span>
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'reset', screenFloor })}
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
          onClick={() => navigate(ROUTES.profile)}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          프로파일 보기 →
        </button>
      </div>
    </section>
  );
}

function EyeResultCard({ eye, data }: { eye: Eye; data: EyeResult }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev-2 p-3">
      <div className="mb-2 text-sm font-semibold text-text">{eyeLabel(eye)}</div>
      <KV>
        <K>LogMAR</K>
        <V>
          {data.logmar === null
            ? '--'
            : (data.logmar >= 0 ? '+' : '') + data.logmar.toFixed(2)}
        </V>
        <K>Snellen</K>
        <V>{data.logmar === null ? '--' : logmarToSnellen(data.logmar)}</V>
        <K>신뢰도</K>
        <V>{data.logmar === null ? '--' : Math.round(data.confidence * 100) + '%'}</V>
      </KV>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────
function currentScreenFloor(c: Calibration): number {
  const arcmin =
    ((MIN_RELIABLE_LETTER_PX * 25.4) / c.screen_ppi) / (c.viewing_distance_cm * 10);
  return Math.log10((arcmin * 10800) / Math.PI / 5);
}

function computeConfidence(history: TrialHistory[]): number {
  if (history.length < 2) return 0.7;
  let reversals = 0;
  let lastDir = 0;
  for (const h of history) {
    const dir = h.correct >= PASS_THRESHOLD ? +1 : -1;
    if (lastDir !== 0 && dir !== lastDir) reversals++;
    lastDir = dir;
  }
  return Math.max(0.55, 0.95 - 0.08 * reversals);
}

function avgConfidence(r: { od: EyeResult; os: EyeResult }): number {
  const vs = [r.od.confidence, r.os.confidence].filter((v) => v > 0);
  if (!vs.length) return 0;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// suppress unused warning for unused MIN_LOGMAR — kept for parity
void MIN_LOGMAR;

// ── tiny KV ───────────────────────────────────────────
function KV({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">{children}</dl>;
}
function K({ children }: { children: React.ReactNode }) {
  return <dt className="text-text-dim">{children}</dt>;
}
function V({ children }: { children: React.ReactNode }) {
  return <dd className="font-mono text-text">{children}</dd>;
}

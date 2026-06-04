import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

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

// ── 폰 근거리 모드 ─────────────────────────────────────
// 폰은 화면을 가까이(~30cm) 들고 봐서, 측정 거리로 그대로 그리면 시표가 sub-mm로
// 작아진다(예: 140 CSS-PPI · 30cm에서 시작 시표 LogMAR 0.3 ≈ 0.87mm).
// 임상 근거리 검사(40cm 표준, 50cm도 폰에 무난)처럼 거리를 50cm로 "고정"하고,
// 카드로 잰 PPI로 그 거리 기준의 정확한 물리 크기를 그린다 — LogMAR 값은 50cm에서
// 유효하므로 사용자에게 그 거리를 안내한다.
//   참고: 임상 표준은 가장 큰 시표(20/200 = LogMAR 1.0)에서 시작해 좁혀간다.
//   첫 시표가 확실히 보이도록 근거리 모드 시작을 LogMAR 1.0으로 둔다.
const NEAR_MODE_DISTANCE_CM = 50;
const NEAR_START_LOGMAR = 1.0;

type Phase = 'choose' | 'manual' | 'intro' | 'test' | 'test_preview' | 'combined';

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
  manual?: boolean; // 측정이 아니라 사용자가 직접 입력한 값
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
    phase: 'choose',
    eye: 'od',
    orderIdx: 0,
    results: { od: { ...EMPTY_EYE }, os: { ...EMPTY_EYE } },
    staircase: null,
    trial: null,
  };
}

function freshStaircase(screenFloor: number, startLogmar: number = START_LOGMAR): Staircase {
  return {
    currentLogMAR: clamp(startLogmar, screenFloor, MAX_LOGMAR),
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
  | { type: 'choose_measure' }
  | { type: 'choose_manual' }
  | { type: 'save_manual'; od: EyeResult | null; os: EyeResult | null }
  | { type: 'start_test'; screenFloor: number; start: number }
  | { type: 'next_trial' }
  | { type: 'set_input'; input: string[] }
  | { type: 'submit'; result: EyeResult | null; staircase?: Staircase }
  | { type: 'go_intro' }
  | { type: 'redo_eye'; screenFloor: number; start: number }
  | { type: 'advance_eye'; screenFloor: number; start: number }
  | { type: 'reset'; screenFloor: number; start: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'choose_measure':
      return { ...state, phase: 'intro', eye: 'od', orderIdx: 0 };
    case 'choose_manual':
      return { ...state, phase: 'manual' };
    case 'save_manual':
      return {
        ...state,
        results: {
          od: action.od ?? { ...EMPTY_EYE },
          os: action.os ?? { ...EMPTY_EYE },
        },
        staircase: null,
        trial: null,
        phase: 'combined',
      };
    case 'start_test':
      return {
        ...state,
        phase: 'test',
        staircase: freshStaircase(action.screenFloor, action.start),
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
        staircase: freshStaircase(action.screenFloor, action.start),
        trial: freshTrial(),
        phase: 'test',
      };
    case 'advance_eye':
      if (state.orderIdx === 0) {
        return {
          ...state,
          orderIdx: 1,
          eye: 'os',
          staircase: freshStaircase(action.screenFloor, action.start),
          trial: null,
          phase: 'intro',
        };
      }
      return { ...state, phase: 'combined' };
    case 'reset':
      return {
        ...freshState(),
        staircase: freshStaircase(action.screenFloor, action.start),
      };
  }
}

function VisionPage() {
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);
  const [state, dispatch] = useReducer(reducer, undefined, freshState);
  const [nearMode, setNearMode] = useState(isCoarsePointer);

  if (!profile.calibration) {
    return (
      <GateCalibration reason="시력 검사 자극의 픽셀 크기는 화면 PPI · 시청 거리로 계산됩니다." />
    );
  }

  const calib = profile.calibration;
  // 근거리 모드: 측정된 가까운 거리 대신 50cm 고정 거리를 사용해 시표를 그린다.
  const testDistanceCm = nearMode ? NEAR_MODE_DISTANCE_CM : calib.viewing_distance_cm;
  // 근거리 모드는 첫 시표가 확실히 보이도록 큰 시표(20/200)에서 시작.
  const startLogmar = nearMode ? NEAR_START_LOGMAR : START_LOGMAR;
  const screenFloor = currentScreenFloor(calib.screen_ppi, testDistanceCm);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">LogMAR 시력 검사</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {state.phase === 'combined'
            ? '종합 결과'
            : state.phase === 'choose' || state.phase === 'manual'
              ? '시작'
              : eyeLabel(state.eye)}
        </span>
      </header>

      {/* 측정과 관련된 단계에서만 근거리 모드 안내 */}
      {(state.phase === 'intro' || state.phase === 'test') && (
        <NearModeBanner
          nearMode={nearMode}
          testDistanceCm={testDistanceCm}
          onToggle={() => setNearMode((v) => !v)}
        />
      )}

      {state.phase === 'choose' && <ChoosePhase dispatch={dispatch} />}
      {state.phase === 'manual' && <ManualPhase dispatch={dispatch} profile={profile} />}

      {state.phase === 'intro' && (
        <IntroPhase
          state={state}
          dispatch={dispatch}
          screenFloor={screenFloor}
          startLogmar={startLogmar}
        />
      )}
      {state.phase === 'test' && state.trial && state.staircase && (
        <TestPhase
          state={state}
          dispatch={dispatch}
          calib={calib}
          distanceCm={testDistanceCm}
          screenFloor={screenFloor}
          onPersistEye={(eye, r) => update((p) => persistEye(p, eye, r))}
        />
      )}
      {state.phase === 'test_preview' && (
        <PreviewPhase
          state={state}
          dispatch={dispatch}
          profile={profile}
          screenFloor={screenFloor}
          startLogmar={startLogmar}
        />
      )}
      {state.phase === 'combined' && (
        <CombinedPhase
          state={state}
          dispatch={dispatch}
          screenFloor={screenFloor}
          startLogmar={startLogmar}
          onSave={() =>
            update((p) => ({
              ...p,
              logmar: {
                od: toSlot(state.results.od),
                os: toSlot(state.results.os),
              },
            }))
          }
        />
      )}
    </div>
  );
}

export default VisionPage;

/** EyeResult → 프로파일 저장용 LogMAREye (미측정이면 null). 측정·직접입력 공통. */
function toSlot(r: EyeResult): LogMAREye | null {
  if (r.logmar === null) return null;
  return {
    logmar: r.logmar,
    confidence: r.confidence,
    screen_limited: r.screenLimited,
    manual: r.manual,
  };
}

function persistEye(p: VCDProfile, eye: Eye, r: EyeResult): VCDProfile {
  const slot = toSlot(r);
  if (!slot) return p;
  const cur = p.logmar ?? { od: null, os: null };
  return { ...p, logmar: { ...cur, [eye]: slot } };
}

function eyeLabel(e: Eye): string {
  return e === 'od' ? '오른쪽 눈 (OD)' : '왼쪽 눈 (OS)';
}

function coverLabel(e: Eye): string {
  return e === 'od' ? '왼쪽' : '오른쪽';
}

// ── 근거리 모드 배너 ──────────────────────────────────
function NearModeBanner({
  nearMode,
  testDistanceCm,
  onToggle,
}: {
  nearMode: boolean;
  testDistanceCm: number;
  onToggle: () => void;
}) {
  if (nearMode) {
    return (
      <div className="mb-4 rounded-md border border-accent/30 bg-accent/5 p-3 text-sm text-text">
        📱 <strong>폰 근거리 모드</strong> — 카드 캘리브레이션 PPI 기준으로,{' '}
        <strong className="text-text">{Math.round(testDistanceCm)} cm 고정 거리</strong>의 정확한
        시표 크기로 표시합니다. 가장 큰 글자부터 시작해 점점 작아집니다.
        <span className="mt-1 block text-xs text-text-dim">
          LogMAR 값이 정확하려면 폰을 화면에서{' '}
          <strong className="text-text">약 {Math.round(testDistanceCm)} cm</strong> 떨어뜨려 보세요.
          (시표 크기 = 거리 × 시각 — 더 가까이 보면 그만큼 작은 게 물리적으로 맞습니다.)
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 rounded-md border border-line bg-bg-elev-2 px-2.5 py-1 text-xs hover:border-accent"
        >
          정밀 모드로 전환 (측정 거리 그대로)
        </button>
      </div>
    );
  }
  return (
    <div className="mb-4 text-xs text-text-dim">
      글자가 너무 작나요?{' '}
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md border border-line bg-bg-elev-2 px-2 py-0.5 hover:border-accent"
      >
        📱 폰 근거리 모드 켜기
      </button>
    </div>
  );
}

// ── Phase: 시작 선택 (측정 vs 직접 입력) ──────────────
function ChoosePhase({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">시력을 어떻게 기록할까요?</h3>
      <p className="mb-4 text-sm text-text-dim">
        화면으로 직접 측정하거나, 이미 알고 있는 시력 값을 바로 입력할 수 있습니다.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'choose_measure' })}
          className="flex flex-col items-start gap-1 rounded-md border border-accent/40 bg-accent/5 p-4 text-left hover:border-accent"
        >
          <span className="text-base font-semibold text-text">📏 직접 측정하기</span>
          <span className="text-sm text-text-dim">
            양쪽 눈을 순서대로 검사합니다 (Sloan 글자, 약 1~2분).
          </span>
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'choose_manual' })}
          className="flex flex-col items-start gap-1 rounded-md border border-line bg-bg-elev-2 p-4 text-left hover:border-accent"
        >
          <span className="text-base font-semibold text-text">⌨️ 양쪽 시력 직접 입력</span>
          <span className="text-sm text-text-dim">
            안과/검안에서 받은 시력(예: 1.0, 0.8)을 그대로 입력합니다.
          </span>
        </button>
      </div>
    </section>
  );
}

// ── Phase: 양쪽 시력 직접 입력 ─────────────────────────
function ManualPhase({
  dispatch,
  profile,
}: {
  dispatch: React.Dispatch<Action>;
  profile: VCDProfile;
}) {
  // 기존 저장값이 있으면 그 소수시력을 초기 선택으로 복원
  const [od, setOd] = useState<string>(() => logmarToDecimalStr(profile.logmar?.od?.logmar));
  const [os, setOs] = useState<string>(() => logmarToDecimalStr(profile.logmar?.os?.logmar));

  const odResult = manualEyeResultFromStr(od);
  const osResult = manualEyeResultFromStr(os);
  const canSave = odResult !== null || osResult !== null;

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">양쪽 시력 직접 입력</h3>
      <p className="mb-4 text-sm text-text-dim">
        한국식 소수시력(예: 1.0, 0.8, 0.5)으로 선택해 주세요. 모르는 눈은 “모름”으로 두면 됩니다.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DecimalVAField label="오른쪽 눈 (OD)" value={od} onChange={setOd} result={odResult} />
        <DecimalVAField label="왼쪽 눈 (OS)" value={os} onChange={setOs} result={osResult} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'choose_measure' })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          ← 측정으로 전환
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => dispatch({ type: 'save_manual', od: odResult, os: osResult })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-text-dim"
        >
          이 값으로 저장 →
        </button>
      </div>
    </section>
  );
}

function DecimalVAField({
  label,
  value,
  onChange,
  result,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  result: EyeResult | null;
}) {
  return (
    <label className="flex flex-col gap-1.5 rounded-md border border-line bg-bg-elev-2 p-3 text-sm">
      <span className="font-semibold text-text">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line bg-bg-elev px-2 py-1.5 text-text"
      >
        <option value="">모름 / 미입력</option>
        {DECIMAL_VA_OPTIONS.map((d) => (
          <option key={d} value={String(d)}>
            시력 {formatVA(d)}
          </option>
        ))}
      </select>
      <span className="font-mono text-xs text-text-dim">
        {result
          ? `LogMAR ${(result.logmar! >= 0 ? '+' : '') + result.logmar!.toFixed(2)} · ${logmarToSnellen(result.logmar!)}`
          : '저장되지 않음'}
      </span>
    </label>
  );
}

// ── Phases ────────────────────────────────────────────
function IntroPhase({
  state,
  dispatch,
  screenFloor,
  startLogmar,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  screenFloor: number;
  startLogmar: number;
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
          ※ 측정 가능 최소 LogMAR ≈ {screenFloor.toFixed(2)} (그보다 좋은 시력은 화면 해상도 한계로
          측정 불가).
        </p>
      )}
      <button
        type="button"
        onClick={() => dispatch({ type: 'start_test', screenFloor, start: startLogmar })}
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
  distanceCm,
  screenFloor,
  onPersistEye,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  calib: Calibration;
  distanceCm: number;
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
    const letterPx = logmarToPx(lm, distanceCm, calib.screen_ppi);
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
    ctx.textAlign = 'center';
    // textBaseline='alphabetic' + 측정 잉크 박스로 수직 정렬.
    // ('middle'은 leading 포함 em 박스를 중심에 둬서 cap 박스가 어긋남)
    ctx.textBaseline = 'alphabetic';
    const xStep = (letterPx + interLetter) * dpr;
    const xStart = (padding + letterPx / 2) * dpr;
    const yMid = cv.height / 2;

    // 핵심 보정: ctx.font의 px는 글자 높이가 아니라 em 크기 → 대문자 실제 높이는
    // ~0.716배(Arial)밖에 안 됨. logmarToPx가 준 '물리적 글자 높이'를 정확히
    // 그리려면, 글자별 cap 높이를 measureText로 재서 폰트 크기를 역산한다.
    // (Sloan의 둥근 글자 O·C·S 오버슈트까지 글자별로 정확히 처리됨)
    const FONT = (px: number) => `bold ${px}px "Helvetica Neue", Arial, sans-serif`;
    const PROBE = 200; // 측정용 임시 폰트 크기 (device px)
    const targetCapPx = letterPx * dpr; // 목표 물리 글자(대문자) 높이
    trial.letters.forEach((L, i) => {
      // pass 1 — 이 글자의 cap 높이 / em 비율 측정
      ctx.font = FONT(PROBE);
      const pm = ctx.measureText(L);
      const pAsc = Math.abs(pm.actualBoundingBoxAscent);
      const pDesc = Math.abs(pm.actualBoundingBoxDescent ?? 0);
      const measurable = Number.isFinite(pAsc) && pAsc > 0;
      const ratio = measurable ? (pAsc + pDesc) / PROBE : 0.716; // 폴백: Arial cap 비율
      const fontPx = targetCapPx / ratio;
      // pass 2 — 보정된 크기로 렌더, 잉크 박스를 세로 중앙에 배치
      ctx.font = FONT(fontPx);
      const m = ctx.measureText(L);
      const a = measurable ? Math.abs(m.actualBoundingBoxAscent) : fontPx * 0.716;
      const d = measurable ? Math.abs(m.actualBoundingBoxDescent ?? 0) : 0;
      const baseline = yMid + (a + d) / 2 - d;
      ctx.fillText(L, xStart + i * xStep, baseline);
    });
  }, [trial.letters, sc.currentLogMAR, calib, distanceCm]);

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
  startLogmar,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  profile: VCDProfile;
  screenFloor: number;
  startLogmar: number;
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
          onClick={() => dispatch({ type: 'redo_eye', screenFloor, start: startLogmar })}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          이 눈 다시
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'advance_eye', screenFloor, start: startLogmar })}
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
        <V>{(sph >= 0 ? '+' : '') + sph.toFixed(2)} D</V>
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
  startLogmar,
  onSave,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  screenFloor: number;
  startLogmar: number;
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
          onClick={() => dispatch({ type: 'reset', screenFloor, start: startLogmar })}
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
          onClick={() => {
            onSave();
            navigate(ROUTES.profile);
          }}
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
      <div className="mb-2 flex items-center justify-between text-sm font-semibold text-text">
        <span>{eyeLabel(eye)}</span>
        {data.logmar !== null && data.manual && (
          <span className="rounded border border-line px-1.5 py-0.5 text-xs font-normal text-text-dim">
            직접 입력
          </span>
        )}
      </div>
      <KV>
        <K>LogMAR</K>
        <V>
          {data.logmar === null ? '--' : (data.logmar >= 0 ? '+' : '') + data.logmar.toFixed(2)}
        </V>
        <K>Snellen</K>
        <V>{data.logmar === null ? '--' : logmarToSnellen(data.logmar)}</V>
        <K>{data.manual ? '소수시력' : '신뢰도'}</K>
        <V>
          {data.logmar === null
            ? '--'
            : data.manual
              ? (() => {
                  const va = logmarToNearestVA(data.logmar);
                  return va === null ? '--' : formatVA(va);
                })()
              : Math.round(data.confidence * 100) + '%'}
        </V>
      </KV>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────
function currentScreenFloor(ppi: number, distanceCm: number): number {
  const arcmin = (MIN_RELIABLE_LETTER_PX * 25.4) / ppi / (distanceCm * 10);
  return Math.log10((arcmin * 10800) / Math.PI / 5);
}

/** 현재 환경이 폰/터치(coarse pointer)인지 — 근거리 모드 기본값 판단용. */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || window.innerWidth < 640;
}

// ── 직접 입력 (소수시력 ↔ LogMAR) ─────────────────────
/** 한국식 표준 소수시력 단계 (시력표 값). LogMAR = -log10(decimal). */
const DECIMAL_VA_OPTIONS = [2.0, 1.5, 1.2, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1];

/** 소수시력 표시 형식: 정수는 소수1자리(1→"1.0"), 그 외는 그대로(0.15→"0.15"). */
function formatVA(d: number): string {
  return Number.isInteger(d) ? d.toFixed(1) : String(d);
}

/** 소수시력 문자열 → 직접 입력 EyeResult (빈 값/유효하지 않으면 null). */
function manualEyeResultFromStr(s: string): EyeResult | null {
  const d = Number(s);
  if (!s || !Number.isFinite(d) || d <= 0) return null;
  return {
    logmar: round2(-Math.log10(d)),
    confidence: 1,
    history: [],
    converged: true,
    screenLimited: false,
    manual: true,
  };
}

/** LogMAR → 가장 가까운 표준 소수시력. 없으면 null. */
function logmarToNearestVA(logmar?: number | null): number | null {
  if (logmar === null || logmar === undefined || !Number.isFinite(logmar)) return null;
  const decimal = Math.pow(10, -logmar);
  let best = DECIMAL_VA_OPTIONS[0];
  let bestDiff = Infinity;
  for (const d of DECIMAL_VA_OPTIONS) {
    const diff = Math.abs(d - decimal);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

/** LogMAR → select value 문자열(표준 옵션과 일치). 없으면 ''. */
function logmarToDecimalStr(logmar?: number | null): string {
  const va = logmarToNearestVA(logmar);
  return va === null ? '' : String(va);
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
function round2(x: number): number {
  return Math.round(x * 100) / 100;
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

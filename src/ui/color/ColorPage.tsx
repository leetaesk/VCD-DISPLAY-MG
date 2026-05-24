import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { IDENTITY_3, type RGBMatrix3 } from '@/constants/machado';
import { ROUTES } from '@/constants/routes';
import {
  computeFinalResult,
  type FinalResult,
  type PlateResponse,
} from '@/features/color/classify';
import {
  FM100_COLORS,
  FM100_COUNT,
  computeFM100Error,
  hslToRgb,
  makeShuffledOrder,
} from '@/features/color/fm100';
import { PLATES, type Plate } from '@/features/color/ishiharaPlates';
import { simulateMatrix } from '@/features/color/machado';
import { useProfileStore } from '@/store/profileStore';

/* ─────────────────────────────────────────────────────────
   ColorPage — Ishihara plates + FM100 sort + Machado classify.
   원본: color-test.js + page-color template.
   양안 동시 검사 — 캘리브레이션 불필요.
   ───────────────────────────────────────────────────────── */

type Phase = 'intro' | 'ishihara' | 'fm100' | 'preview';

function ColorPage() {
  const update = useProfileStore((s) => s.update);
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('intro');
  const [plateIdx, setPlateIdx] = useState(0);
  const [responses, setResponses] = useState<PlateResponse[]>([]);
  const [fmOrder, setFmOrder] = useState<number[]>(() => makeShuffledOrder());
  const [fmSelected, setFmSelected] = useState<number>(-1);
  const [result, setResult] = useState<FinalResult | null>(null);

  const respondPlate = (response: string) => {
    const plate = PLATES[plateIdx];
    const next = [...responses, { plate, response, correct: response === plate.digit }];
    setResponses(next);
    if (plateIdx + 1 >= PLATES.length) {
      setFmOrder(makeShuffledOrder());
      setFmSelected(-1);
      setPhase('fm100');
    } else {
      setPlateIdx(plateIdx + 1);
    }
  };

  const onFMTap = (slotIdx: number) => {
    if (slotIdx === 0 || slotIdx === FM100_COUNT - 1) return;
    if (fmSelected === -1) {
      setFmSelected(slotIdx);
    } else if (fmSelected === slotIdx) {
      setFmSelected(-1);
    } else {
      const next = fmOrder.slice();
      [next[fmSelected], next[slotIdx]] = [next[slotIdx], next[fmSelected]];
      setFmOrder(next);
      setFmSelected(-1);
    }
  };

  const submitFM = () => {
    const err = computeFM100Error(fmOrder);
    const final = computeFinalResult(responses, err);
    setResult(final);
    setPhase('preview');
  };

  const reset = () => {
    setPhase('intro');
    setPlateIdx(0);
    setResponses([]);
    setFmOrder(makeShuffledOrder());
    setFmSelected(-1);
    setResult(null);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">색각 검사</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          양안 동시
        </span>
      </header>

      {phase === 'intro' && (
        <IntroPhase
          onStart={() => {
            setPlateIdx(0);
            setResponses([]);
            setPhase('ishihara');
          }}
        />
      )}
      {phase === 'ishihara' && (
        <IshiharaPhase
          plate={PLATES[plateIdx]}
          plateIdx={plateIdx}
          total={PLATES.length}
          onRespond={respondPlate}
        />
      )}
      {phase === 'fm100' && (
        <FM100Phase
          order={fmOrder}
          selectedSlot={fmSelected}
          onTap={onFMTap}
          onReset={() => {
            setFmOrder(makeShuffledOrder());
            setFmSelected(-1);
          }}
          onSubmit={submitFM}
        />
      )}
      {phase === 'preview' && result && (
        <PreviewPhase
          result={result}
          onRedo={reset}
          onSave={() => {
            update((p) => ({
              ...p,
              color_vision: {
                type: castType(result.type),
                severity: result.severity,
                lut_id: result.correction_lut.machadoKey ?? undefined,
                correction_lut: { matrix: result.correction_lut.matrix.map((r) => r.slice()) },
              },
            }));
          }}
          onProfile={() => navigate(ROUTES.profile)}
        />
      )}
    </div>
  );
}

export default ColorPage;

function castType(
  t: string,
): 'normal' | 'protanomaly' | 'deuteranomaly' | 'tritanomaly' | 'achromatopsia' {
  switch (t) {
    case 'normal':
    case 'protanomaly':
    case 'deuteranomaly':
    case 'tritanomaly':
    case 'achromatopsia':
      return t;
    default:
      // mild_anomaly 등은 스키마에서 표현 못 함 — deuteranomaly로 보존.
      return 'deuteranomaly';
  }
}

// ── Intro ─────────────────────────────────────────────
function IntroPhase({ onStart }: { onStart: () => void }) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">검사 준비</h3>
      <p className="mb-3 text-text">
        두 눈을 모두 뜨고 진행합니다. 색각은 좌우 융합되므로 한쪽씩 검사하지 않습니다.
      </p>
      <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm text-text">
        <li>
          <strong>Ishihara 형 10판</strong>: 색 점 패턴 안의 숫자를 읽고 응답합니다.
        </li>
        <li>
          <strong>FM100 (16색) 정렬</strong>: 색 카드를 색상환 순서대로 정렬합니다.
        </li>
      </ol>
      <p className="mb-3 text-sm text-text-dim">
        ※ 검사 중에는 <strong>실내 조명을 켜고</strong> 화면 밝기를 평소 수준으로 설정해 주세요.
      </p>
      <p className="mb-4 text-xs text-text-dim">예상 소요 시간 약 5분</p>
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

// ── Ishihara ──────────────────────────────────────────
function IshiharaPhase({
  plate,
  plateIdx,
  total,
  onRespond,
}: {
  plate: Plate;
  plateIdx: number;
  total: number;
  onRespond: (response: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (canvasRef.current) drawIshiharaPlate(canvasRef.current, plate);
  }, [plate]);

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <span>
          판 <strong className="text-text">{plateIdx + 1}</strong>/
          <strong className="text-text">{total}</strong>
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-elev-2">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(plateIdx / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="mb-4 flex justify-center">
        <canvas ref={canvasRef} className="rounded-full" />
      </div>

      <p className="mb-3 text-center text-sm text-text">점 패턴 안에 어떤 숫자가 보이나요?</p>

      <div className="mb-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {Array.from({ length: 10 }).map((_, d) => (
          <button
            key={d}
            type="button"
            onClick={() => onRespond(String(d))}
            className="min-h-11 rounded-md border border-line bg-bg-elev-2 py-3 font-mono text-lg text-text hover:border-accent"
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => onRespond('?')}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          아무것도 안 보임
        </button>
      </div>
    </section>
  );
}

function drawIshiharaPlate(canvas: HTMLCanvasElement, plate: Plate) {
  const SIZE = 360;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = canvas.style.height = SIZE + 'px';
  canvas.width = canvas.height = SIZE * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#f4ead8';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const mask = document.createElement('canvas');
  mask.width = mask.height = SIZE;
  const mctx = mask.getContext('2d')!;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, SIZE, SIZE);
  mctx.fillStyle = '#fff';
  mctx.font = `bold ${Math.round(SIZE * 0.62)}px sans-serif`;
  mctx.textAlign = 'center';
  mctx.textBaseline = 'middle';
  mctx.fillText(plate.digit, SIZE / 2, SIZE / 2 + 6);
  const md = mctx.getImageData(0, 0, SIZE, SIZE).data;

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outerR = SIZE * 0.46;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, 2 * Math.PI);
  ctx.clip();

  const DOT_N = 700;
  for (let i = 0; i < DOT_N; i++) {
    const ang = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * outerR;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    const mi = (Math.floor(y) * SIZE + Math.floor(x)) * 4;
    const isFigure = md[mi] > 128;
    const base = isFigure ? plate.fg : plate.bg;
    const jitter = () => (Math.random() - 0.5) * 28;
    const cr = clamp(base[0] + jitter(), 0, 255) | 0;
    const cg = clamp(base[1] + jitter(), 0, 255) | 0;
    const cb = clamp(base[2] + jitter(), 0, 255) | 0;
    const radius = 3.5 + Math.random() * 5;
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── FM100 ─────────────────────────────────────────────
function FM100Phase({
  order,
  selectedSlot,
  onTap,
  onReset,
  onSubmit,
}: {
  order: number[];
  selectedSlot: number;
  onTap: (slotIdx: number) => void;
  onReset: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">색 카드 정렬</h3>
      <p className="mb-2 text-text">
        양 끝 두 카드는 고정되어 있습니다. 가운데 14장을 색상환 순서대로 정렬해 주세요.
      </p>
      <p className="mb-4 text-xs text-text-dim">
        탭하여 카드 선택 → 다른 위치 탭하면 두 카드가 교환됩니다.
      </p>

      {/* 모바일은 한 줄에 16칸이면 ~22px이라 탭 불가 → 2줄로 분할.
          FM100은 양 끝(0, FM100_COUNT-1)이 고정이라 분할로 평가가 깨지지 않음. */}
      <div
        className="mb-4 grid grid-cols-8 gap-1 sm:grid-cols-[repeat(var(--fm100-cols),minmax(0,1fr))]"
        style={{ ['--fm100-cols' as string]: FM100_COUNT }}
      >
        {order.map((colorIdx, slot) => {
          const [r, g, b] = FM100_COLORS[colorIdx];
          const isAnchor = slot === 0 || slot === FM100_COUNT - 1;
          const isSelected = slot === selectedSlot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onTap(slot)}
              disabled={isAnchor}
              title={isAnchor ? '고정' : '탭하여 선택 후 다른 위치 탭하면 교환'}
              className={[
                'aspect-square rounded-sm border transition-transform',
                isAnchor ? 'cursor-default border-text-dim opacity-90' : 'cursor-pointer',
                isSelected ? 'scale-110 border-accent ring-2 ring-accent' : 'border-line',
              ].join(' ')}
              style={{ backgroundColor: `rgb(${r},${g},${b})` }}
            />
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          섞기
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          정렬 완료 →
        </button>
      </div>
    </section>
  );
}

// ── Preview ───────────────────────────────────────────
function PreviewPhase({
  result,
  onRedo,
  onSave,
  onProfile,
}: {
  result: FinalResult;
  onRedo: () => void;
  onSave: () => void;
  onProfile: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">색각 종합 결과</h3>

      <div className="mb-3 rounded-md border border-line bg-bg-elev-2 p-3">
        <KV>
          <K>유형</K>
          <V>{labelForType(result.type)}</V>
          <K>심각도</K>
          <V>{(result.severity * 100).toFixed(0)}%</V>
          <K>Ishihara 점수</K>
          <V>
            {result.ishihara_score.correct}/{result.ishihara_score.total}
          </V>
          <K>FM100 오차</K>
          <V>{result.fm100_error}</V>
          <K>신뢰도</K>
          <V>{(result.confidence * 100).toFixed(0)}%</V>
        </KV>
      </div>

      <div className="mb-3 rounded-md border border-line bg-bg-elev-2 p-3">
        <h4 className="mb-2 text-sm font-semibold text-text">색각 시뮬레이션</h4>
        <div className="flex flex-wrap justify-center gap-4">
          <WheelFigure caption="① 원본 색상환" matrix={IDENTITY_3} />
          <WheelFigure
            caption="② 당신의 색각 시뮬레이션"
            matrix={simulateMatrix(result.type, result.severity)}
          />
          <WheelFigure
            caption="③ Daltonize 보정 (2I − M)"
            matrix={result.correction_lut.matrix}
          />
        </div>
        <p className="mt-2 text-xs text-text-dim">
          ③ 의 3×3 행렬이 카메라 보정 페이지의 M3 색 변환 단계 입력이 됩니다.
        </p>
      </div>

      <div
        className="mb-3 rounded-md border border-line bg-bg-elev-2 p-3 text-sm text-text"
        dangerouslySetInnerHTML={{ __html: clinicalNote(result.type, result.severity) }}
      />

      <p className="mb-4 text-xs text-text-dim">
        ⓘ 스크리닝 도구이며 의료 진단이 아닙니다. 결과는 안과 전문의 진료를 대체하지 않습니다.
      </p>

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
          시력 프로파일 보기 →
        </button>
      </div>
    </section>
  );
}

function WheelFigure({ caption, matrix }: { caption: string; matrix: RGBMatrix3 }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    drawWheel(cv, matrix);
  }, [matrix]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={cvRef} />
      <figcaption className="text-xs text-text-dim">{caption}</figcaption>
    </figure>
  );
}

function drawWheel(canvas: HTMLCanvasElement, M: RGBMatrix3) {
  const SIZE = 180;
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rMax = SIZE / 2 - 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const i = (y * SIZE + x) * 4;
      if (r > rMax) {
        data[i] = data[i + 1] = data[i + 2] = 18;
        data[i + 3] = 255;
      } else {
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const sat = Math.min(1, r / rMax);
        const [R, G, B] = hslToRgb(hue / 360, sat, 0.55);
        const r0 = R / 255;
        const g0 = G / 255;
        const b0 = B / 255;
        const r2 = M[0][0] * r0 + M[0][1] * g0 + M[0][2] * b0;
        const g2 = M[1][0] * r0 + M[1][1] * g0 + M[1][2] * b0;
        const b2 = M[2][0] * r0 + M[2][1] * g0 + M[2][2] * b0;
        data[i] = clamp(r2 * 255, 0, 255) | 0;
        data[i + 1] = clamp(g2 * 255, 0, 255) | 0;
        data[i + 2] = clamp(b2 * 255, 0, 255) | 0;
        data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function labelForType(t: string): string {
  return (
    ({
      normal: '정상 삼색형',
      protanomaly: '적색약 (protanomaly)',
      deuteranomaly: '녹색약 (deuteranomaly)',
      tritanomaly: '청색약 (tritanomaly)',
      mild_anomaly: '경미한 색각 이상',
      achromatopsia: '전색맹 의심',
    } as Record<string, string>)[t] ?? t
  );
}

function clinicalNote(type: string, severity: number): string {
  if (type === 'normal') {
    return (
      '정상 삼색형 색각으로 측정되었습니다. ' +
      '<span class="text-text-dim">선천적 색각 이상은 남성 약 8%에서 발생합니다.</span>'
    );
  }
  if (type === 'achromatopsia') {
    return (
      '<strong>전색맹 의심</strong>입니다. 검사 환경(조명·화면)을 점검하고 ' +
      '다시 측정해도 동일하면 안과 진료를 권장합니다.'
    );
  }
  const sevWord = severity > 0.7 ? '심한' : severity > 0.4 ? '뚜렷한' : '경미한';
  return (
    `<strong>${sevWord} ${labelForType(type)}</strong> 패턴이 관찰됩니다. ` +
    '<span class="text-text-dim">선천적 색각 이상은 일상 생활에 큰 지장 없는 흔한 양상입니다. ' +
    '갑작스러운 색감 변화가 있다면 안과 진료를 권장합니다.</span>'
  );
}

// ── tiny KV ───────────────────────────────────────────
function KV({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">{children}</dl>;
}
function K({ children }: { children: React.ReactNode }) {
  return <dt className="text-text-dim">{children}</dt>;
}
function V({ children }: { children: React.ReactNode }) {
  return <dd className="font-mono text-text">{children}</dd>;
}

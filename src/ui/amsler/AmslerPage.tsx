import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import GateCalibration from '@/components/GateCalibration';
import { ROUTES } from '@/constants/routes';
import { useProfileStore } from '@/store/profileStore';
import type { Calibration, Eye } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   AmslerPage — 20×20 격자에서 왜곡(빨강)/결손(어둠) 표시 → 256×256 PNG.
   원본: amsler-test.js + page-amsler template.
   ───────────────────────────────────────────────────────── */

const GRID_LINES = 20;
const MAP_SIZE = 256;
const MAX_DISPLAY = 480;
const MIN_DISPLAY = 280;
const BRUSH_MIN_PX = 4;
const BRUSH_MAX_PX = 32;
const BRUSH_DEFAULT = 12;

type Tool = 'distortion' | 'defect' | 'erase';
type Phase = 'intro' | 'test' | 'preview' | 'combined';

interface EyeAnalysis {
  pngBase64: string;
  areaPct: number;
  centroid: { x: number; y: number } | null;
  locations: string[];
}

interface EyeResult {
  distortion: EyeAnalysis;
  defect: EyeAnalysis;
}

function AmslerPage() {
  const profile = useProfileStore((s) => s.profile);
  const update = useProfileStore((s) => s.update);

  if (!profile.calibration) {
    return (
      <GateCalibration reason="Amsler 격자의 시각 크기(20° 시야)는 화면 PPI · 시청 거리에 의존합니다." />
    );
  }

  return <AmslerFlow calib={profile.calibration} onUpdate={update} />;
}

export default AmslerPage;

function AmslerFlow({
  calib,
  onUpdate,
}: {
  calib: Calibration;
  onUpdate: (
    u: (p: import('@/types/profile').VCDProfile) => import('@/types/profile').VCDProfile,
  ) => void;
}) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('intro');
  const [eye, setEye] = useState<Eye>('od');
  const [orderIdx, setOrderIdx] = useState<0 | 1>(0);
  const [tool, setTool] = useState<Tool>('defect');
  const [brushPx, setBrushPx] = useState<number>(BRUSH_DEFAULT);
  const [results, setResults] = useState<{ od: EyeResult | null; os: EyeResult | null }>({
    od: null,
    os: null,
  });

  const distortionBuf = useRef<Uint8Array>(new Uint8Array(MAP_SIZE * MAP_SIZE));
  const defectBuf = useRef<Uint8Array>(new Uint8Array(MAP_SIZE * MAP_SIZE));

  const idealMm = calib.viewing_distance_cm * 3.527;
  const idealPx = Math.round((idealMm * calib.screen_ppi) / 25.4);
  const displayPx = clamp(idealPx, MIN_DISPLAY, MAX_DISPLAY);

  const startEye = () => {
    distortionBuf.current = new Uint8Array(MAP_SIZE * MAP_SIZE);
    defectBuf.current = new Uint8Array(MAP_SIZE * MAP_SIZE);
    setPhase('test');
  };

  const finishEye = () => {
    const dist = analyzeMap(distortionBuf.current);
    const def = analyzeMap(defectBuf.current);
    const r: EyeResult = {
      distortion: {
        pngBase64: bufferToBase64PNG(distortionBuf.current, MAP_SIZE),
        areaPct: dist.areaPct,
        centroid: dist.centroid,
        locations: dist.locations,
      },
      defect: {
        pngBase64: bufferToBase64PNG(defectBuf.current, MAP_SIZE),
        areaPct: def.areaPct,
        centroid: def.centroid,
        locations: def.locations,
      },
    };
    setResults((prev) => ({ ...prev, [eye]: r }));
    // 증분 저장: amsler_map_xx만 (스키마의 단일 PNG 키 = defect 우선)
    onUpdate((p) => ({
      ...p,
      ...(eye === 'od'
        ? { amsler_map_od: r.defect.pngBase64 }
        : { amsler_map_os: r.defect.pngBase64 }),
    }));
    setPhase('preview');
  };

  const advance = () => {
    if (orderIdx === 0) {
      setOrderIdx(1);
      setEye('os');
      setPhase('intro');
    } else {
      setPhase('combined');
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-text">Amsler 시야 검사</h2>
        <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {phase === 'combined' ? '종합 결과' : eyeLabel(eye)}
        </span>
      </header>

      {phase === 'intro' && (
        <IntroPhase
          eye={eye}
          otherDone={results[eye === 'od' ? 'os' : 'od'] !== null}
          calib={calib}
          displayPx={displayPx}
          onStart={startEye}
        />
      )}

      {phase === 'test' && (
        <TestPhase
          displayPx={displayPx}
          tool={tool}
          brushPx={brushPx}
          calib={calib}
          distortionBuf={distortionBuf.current}
          defectBuf={defectBuf.current}
          onTool={setTool}
          onBrush={setBrushPx}
          onClear={() => {
            distortionBuf.current.fill(0);
            defectBuf.current.fill(0);
            // overlay re-render handled via refs
          }}
          onDone={finishEye}
        />
      )}

      {phase === 'preview' && results[eye] && (
        <PreviewPhase
          eye={eye}
          result={results[eye]!}
          onRedo={startEye}
          onNext={advance}
        />
      )}

      {phase === 'combined' && (
        <CombinedPhase
          results={results}
          onRedo={() => {
            setResults({ od: null, os: null });
            setEye('od');
            setOrderIdx(0);
            setPhase('intro');
          }}
          onSave={() => {
            onUpdate((p) => ({
              ...p,
              amsler_map_od: results.od?.defect.pngBase64 ?? null,
              amsler_map_os: results.os?.defect.pngBase64 ?? null,
            }));
          }}
          onProfile={() => navigate(ROUTES.profile)}
        />
      )}
    </div>
  );
}

function eyeLabel(e: Eye) {
  return e === 'od' ? '오른쪽 눈 (OD)' : '왼쪽 눈 (OS)';
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Intro ─────────────────────────────────────────────
function IntroPhase({
  eye,
  otherDone,
  calib,
  displayPx,
  onStart,
}: {
  eye: Eye;
  otherDone: boolean;
  calib: Calibration;
  displayPx: number;
  onStart: () => void;
}) {
  const recCm = Math.round((MAX_DISPLAY * 25.4) / calib.screen_ppi / 3.527);
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-2 text-lg font-semibold text-text">{eyeLabel(eye)} 검사 준비</h3>
      <p className="mb-2 text-text">
        <strong>{eye === 'od' ? '왼쪽' : '오른쪽'}</strong> 눈을 손바닥으로 가리고, 격자 중앙의 흰
        점만 계속 주시합니다.
      </p>
      <p className="mb-3 text-sm text-text-dim">
        {otherDone
          ? '두 번째 눈 — 마지막 검사입니다.'
          : '첫 번째 눈 — 두 눈 순서대로 검사합니다.'}
      </p>
      <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm text-text">
        <li>중앙 흰 점을 응시한 채, 주변시로 격자 전체를 인지합니다.</li>
        <li>
          격자선이 <span className="text-err">휘어 보이는 영역</span> 또는{' '}
          <strong>안 보이는 영역</strong>을 도구를 선택해 표시합니다.
        </li>
        <li>드래그로 영역을 그릴 수 있습니다. 잘못 표시한 부분은 지우개 도구로 지웁니다.</li>
        <li>응시점에서 시선이 벗어나지 않도록 주의하세요.</li>
      </ol>
      <p className="mb-4 text-xs text-text-dim">
        ※ 현재 캘리브레이션 거리: {calib.viewing_distance_cm}cm · 격자 권장 시청 거리: {recCm}cm ·
        실제 표시 크기: {displayPx}px
      </p>
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
  displayPx,
  tool,
  brushPx,
  calib,
  distortionBuf,
  defectBuf,
  onTool,
  onBrush,
  onClear,
  onDone,
}: {
  displayPx: number;
  tool: Tool;
  brushPx: number;
  calib: Calibration;
  distortionBuf: Uint8Array;
  defectBuf: Uint8Array;
  onTool: (t: Tool) => void;
  onBrush: (n: number) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const lastPaintXY = useRef<{ x: number; y: number } | null>(null);
  const [, forceRerender] = useState(0);

  // 격자 + overlay 초기화
  useEffect(() => {
    const grid = gridRef.current;
    const overlay = overlayRef.current;
    if (!grid || !overlay) return;
    drawGrid(grid, displayPx);
    overlay.width = overlay.height = displayPx;
    overlay.style.width = overlay.style.height = displayPx + 'px';
    const octx = overlay.getContext('2d');
    octx?.clearRect(0, 0, displayPx, displayPx);
  }, [displayPx]);

  // 지우기 강제 트리거
  const handleClear = () => {
    onClear();
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.getContext('2d')?.clearRect(0, 0, displayPx, displayPx);
    forceRerender((n) => n + 1);
  };

  const pointerXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = overlayRef.current!;
    const rect = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * cv.width) / rect.width,
      y: ((e.clientY - rect.top) * cv.height) / rect.height,
    };
  };

  const paint = (x: number, y: number) => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const r = brushPx;
    if (tool === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else if (tool === 'distortion') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,90,90,0.42)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(20,20,20,0.85)';
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (tool === 'erase') {
      paintBuffer(distortionBuf, x, y, r, cv.width, 0);
      paintBuffer(defectBuf, x, y, r, cv.width, 0);
    } else {
      paintBuffer(tool === 'distortion' ? distortionBuf : defectBuf, x, y, r, cv.width, 255);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = overlayRef.current!;
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    isDrawing.current = true;
    lastPaintXY.current = null;
    const { x, y } = pointerXY(e);
    paint(x, y);
    lastPaintXY.current = { x, y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const { x, y } = pointerXY(e);
    const last = lastPaintXY.current;
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = Math.max(2, brushPx * 0.4);
      const steps = Math.max(1, Math.ceil(dist / stepLen));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paint(last.x + dx * t, last.y + dy * t);
      }
    } else {
      paint(x, y);
    }
    lastPaintXY.current = { x, y };
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawing.current = false;
    lastPaintXY.current = null;
    const cv = overlayRef.current!;
    try {
      cv.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const fovDeg =
    (2 *
      Math.atan(((displayPx * 25.4) / calib.screen_ppi / 2) / (calib.viewing_distance_cm * 10)) *
      180) /
    Math.PI;

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {(['distortion', 'defect', 'erase'] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTool(t)}
              className={[
                'px-3 py-1.5 text-xs',
                tool === t ? 'bg-accent text-bg' : 'bg-bg-elev-2 text-text hover:bg-bg-elev',
              ].join(' ')}
            >
              {t === 'distortion' ? '왜곡 (빨강)' : t === 'defect' ? '결손 (어둠)' : '지우기'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-text-dim">
          브러시
          <input
            type="range"
            min={BRUSH_MIN_PX}
            max={BRUSH_MAX_PX}
            step={1}
            value={brushPx}
            onChange={(e) => onBrush(Number(e.target.value))}
            className="w-32"
          />
          <span className="w-12 font-mono text-text">{brushPx} px</span>
        </label>
      </div>

      <p className="mb-2 text-center text-xs text-text-dim">
        격자 {displayPx}px = {((displayPx * 25.4) / calib.screen_ppi).toFixed(1)}mm 폭, 약{' '}
        {fovDeg.toFixed(1)}° 시야
      </p>

      {/* 격자는 시청거리·PPI 기반 시야각을 표현하므로 축소 금지.
          모바일에서 폭 초과 시 가로 스크롤. */}
      <div className="-mx-4 mb-3 overflow-x-auto sm:mx-0">
        <div
          className="relative mx-auto border border-line"
          style={{ width: displayPx, height: displayPx }}
        >
          <canvas ref={gridRef} className="absolute inset-0" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 cursor-crosshair"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerLeave={onPointerEnd}
          />
        </div>
      </div>

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={handleClear}
          className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
        >
          전체 지우기
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          검사 완료 →
        </button>
      </div>
    </section>
  );
}

function drawGrid(canvas: HTMLCanvasElement, sizePx: number) {
  canvas.width = canvas.height = sizePx;
  canvas.style.width = canvas.style.height = sizePx + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  const cell = sizePx / GRID_LINES;
  for (let i = 0; i <= GRID_LINES; i++) {
    const pos = Math.round(i * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, sizePx);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(sizePx, pos);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sizePx / 2, sizePx / 2, 5, 0, 2 * Math.PI);
  ctx.fill();
}

function paintBuffer(
  buffer: Uint8Array,
  dispX: number,
  dispY: number,
  dispR: number,
  dispSize: number,
  value: number,
) {
  const scale = MAP_SIZE / dispSize;
  const cx = dispX * scale;
  const cy = dispY * scale;
  const r = dispR * scale;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(MAP_SIZE, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(MAP_SIZE, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) buffer[y * MAP_SIZE + x] = value;
    }
  }
}

function analyzeMap(buf: Uint8Array): {
  areaPct: number;
  centroid: { x: number; y: number } | null;
  locations: string[];
} {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (buf[y * MAP_SIZE + x] > 0) {
        n++;
        sx += x;
        sy += y;
      }
    }
  }
  const total = MAP_SIZE * MAP_SIZE;
  const areaPct = (n / total) * 100;
  if (n === 0) return { areaPct: 0, centroid: null, locations: [] };
  const cx = sx / n;
  const cy = sy / n;
  const center = MAP_SIZE / 2;
  const dist = Math.hypot(cx - center, cy - center) / center;
  let radialZone = 'peripheral';
  if (dist < 0.18) radialZone = 'central';
  else if (dist < 0.35) radialZone = 'paracentral';
  const quadrant = `${cy < center ? 'superior' : 'inferior'}_${cx < center ? 'left' : 'right'}`;
  return {
    areaPct: Math.round(areaPct * 10) / 10,
    centroid: { x: cx / MAP_SIZE, y: cy / MAP_SIZE },
    locations: [radialZone, quadrant],
  };
}

function bufferToBase64PNG(buf: Uint8Array, size: number): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = buf[i];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
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
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    drawMapPreview(cvRef.current, result);
  }, [result]);

  const loc = Array.from(
    new Set([...result.distortion.locations, ...result.defect.locations]),
  );

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">{eyeLabel(eye)} 결과</h3>
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
        <canvas ref={cvRef} className="rounded-md border border-line" />
        <div className="rounded-md border border-line bg-bg-elev-2 p-3 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-text-dim">왜곡 면적</span>
            <span className="font-mono text-text">{result.distortion.areaPct.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-text-dim">결손 면적</span>
            <span className="font-mono text-text">{result.defect.areaPct.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-text-dim">위치</span>
            <span className="font-mono text-text">{loc.length ? loc.join(', ') : '없음'}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
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

function drawMapPreview(canvas: HTMLCanvasElement | null, r: EyeResult) {
  if (!canvas) return;
  const size = 192;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(150,150,150,0.5)';
  ctx.lineWidth = 1;
  const step = size / 10;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, 2 * Math.PI);
  ctx.fill();

  // overlay marks from PNG via Image
  const drawOverlay = (src: string, color: string) => {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.fillStyle = color;
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = size;
      const tctx = tmp.getContext('2d')!;
      tctx.drawImage(img, 0, 0, size, size);
      const data = tctx.getImageData(0, 0, size, size).data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          if (data[i] > 0) {
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      ctx.restore();
    };
    img.src = src;
  };
  drawOverlay(r.distortion.pngBase64, 'rgba(230,90,90,0.7)');
  drawOverlay(r.defect.pngBase64, 'rgba(30,30,30,0.9)');
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
  const cls = classify(results);
  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">Amsler 종합 결과</h3>
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {(['od', 'os'] as Eye[]).map((e) => {
          const r = results[e];
          return (
            <div key={e} className="rounded-md border border-line bg-bg-elev-2 p-3">
              <div className="mb-2 text-sm font-semibold text-text">{eyeLabel(e)}</div>
              {r ? (
                <>
                  {r.defect.pngBase64 && (
                    <img
                      src={r.defect.pngBase64}
                      alt={`${e} defect map`}
                      className="mb-2 h-32 w-32 rounded-md border border-line bg-black"
                    />
                  )}
                  <div className="text-xs text-text-dim">
                    왜곡 <span className="font-mono text-text">{r.distortion.areaPct.toFixed(1)}%</span> ·
                    결손 <span className="font-mono text-text">{r.defect.areaPct.toFixed(1)}%</span>
                  </div>
                  <div className="text-xs text-text-dim">
                    위치{' '}
                    <span className="font-mono text-text">
                      {Array.from(new Set([...r.distortion.locations, ...r.defect.locations])).join(
                        ', ',
                      ) || '없음'}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-text-dim">측정 없음</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mb-4 rounded-md border border-line bg-bg-elev-2 p-3">
        <div className="mb-1">
          <span
            className={[
              'rounded-md border px-2 py-0.5 text-xs font-semibold',
              cls.flagged ? 'border-err/40 bg-err/10 text-err' : 'border-line bg-bg text-text',
            ].join(' ')}
          >
            {cls.label}
          </span>
        </div>
        <p className="text-sm text-text">{cls.note}</p>
        <p className="mt-2 text-xs text-text-dim">
          ⓘ 스크리닝 도구이며 의료 진단이 아닙니다. 황반변성·녹내장 조기 진단의 중요성을 고려해
          정기 안과 검진을 권장합니다.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
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
          시력 프로파일 보기 →
        </button>
      </div>
    </section>
  );
}

function classify(results: { od: EyeResult | null; os: EyeResult | null }): {
  label: string;
  note: string;
  flagged: boolean;
} {
  const od = results.od;
  const os = results.os;
  if (!od && !os)
    return {
      label: '측정 없음',
      note: '결과가 없습니다.',
      flagged: false,
    };
  const odCentral =
    !!od && (od.distortion.locations.includes('central') || od.defect.locations.includes('central'));
  const osCentral =
    !!os && (os.distortion.locations.includes('central') || os.defect.locations.includes('central'));
  const odPerLg =
    !!od && od.defect.areaPct > 5 && od.defect.locations.includes('peripheral');
  const osPerLg =
    !!os && os.defect.areaPct > 5 && os.defect.locations.includes('peripheral');
  const odAny = !!od && od.distortion.areaPct + od.defect.areaPct > 0;
  const osAny = !!os && os.distortion.areaPct + os.defect.areaPct > 0;

  if (!odAny && !osAny) {
    return {
      label: '정상 범위',
      note: '결손/왜곡 없음 — 황반변성·녹내장 1차 스크리닝 정상 범위.',
      flagged: false,
    };
  }
  if (odCentral || osCentral) {
    return {
      label: '중심부 왜곡 의심',
      note: '중심부 격자 왜곡이 보고되었습니다 — 황반변성 가능성. 안과 진료를 권장합니다.',
      flagged: true,
    };
  }
  if (odPerLg || osPerLg) {
    return {
      label: '주변부 큰 결손',
      note: '주변부 시야 결손이 크게 표시되었습니다 — 녹내장 가능성. 안과 진료를 권장합니다.',
      flagged: true,
    };
  }
  return {
    label: '경미한 비정상',
    note: '작은 표시가 있으나 의미 있는 정도는 아닐 수 있습니다. 최근 시야 변화가 있다면 안과 상담을 권장합니다.',
    flagged: false,
  };
}

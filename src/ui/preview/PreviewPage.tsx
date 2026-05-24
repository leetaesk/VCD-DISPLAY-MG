import { useEffect, useMemo, useRef, useState } from 'react';

import { Link } from 'react-router-dom';

import { ROUTES } from '@/constants/routes';
import { fft2dPacked, mulComplexPacked } from '@/features/vcd/fft';
import {
  createGLContext,
  createPipelinePrograms,
  disposeGLContext,
  disposePipelinePrograms,
  makeComplexTexture,
  packComplexToRGBA,
  readComplex,
  type GLContext,
  type PipelinePrograms,
} from '@/features/vcd/glContext';
import { generatePSF } from '@/features/vcd/psf';
import { WienerPipeline } from '@/features/vcd/wienerPipeline';
import { useProfileStore } from '@/store/profileStore';
import type { Eye, EyeRefraction, VCDProfile } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   PreviewPage — VCD 미리보기 (M1 → M4 end-to-end).
   원본: preview-page.js + page-preview template.

   4 patterns @ 256×256:
     ① 의도된 화면
     ② 보정 없이 본 모습 = IFFT(F · H)
     ③ 디스플레이 출력  = Wiener pre-filtered
     ④ VCD 적용 후     = IFFT(F_displayed · H)

   캐싱: F_intended(콘텐츠) · H(눈) · K(슬라이더)
   ───────────────────────────────────────────────────────── */

const N = 256;

const K_LEVELS = [
  { label: '선명함 강하게', sub: '노이즈 가능', K: 1e-5 },
  { label: '선명함', sub: '', K: 1e-4 },
  { label: '균형', sub: '권장', K: 1e-3 },
  { label: '약하게', sub: '', K: 1e-2 },
  { label: '노이즈 적게', sub: '보정 약함', K: 1e-1 },
];

type ContentType = 'text' | 'photo' | 'upload';

function PreviewPage() {
  const profile = useProfileStore((s) => s.profile);

  if (!hasRefraction(profile)) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-md border border-warn/40 bg-warn/5 p-5">
          <h3 className="mb-2 text-lg font-semibold text-warn">
            🔭 굴절 검사가 먼저 필요합니다
          </h3>
          <p className="mb-3 text-sm text-text">
            VCD 미리보기는 사용자의 SPH / CYL / AXIS로 계산된 PSF를 사용합니다.
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

  return <PreviewApp profile={profile} />;
}

export default PreviewPage;

function hasRefraction(p: VCDProfile): boolean {
  const r = p.refraction;
  if (!r) return false;
  return !!r.od || !!r.os;
}

function PreviewApp({ profile }: { profile: VCDProfile }) {
  const odAvailable = !!profile.refraction?.od;
  const osAvailable = !!profile.refraction?.os;
  const [eye, setEye] = useState<Eye>(odAvailable ? 'od' : 'os');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [kLevel, setKLevel] = useState<number>(3);

  // WebGL context
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gl, setGl] = useState<{
    ctx: GLContext;
    programs: PipelinePrograms;
    pipeline: WienerPipeline;
  } | null>(null);
  const [glError, setGlError] = useState<Error | null>(null);

  useEffect(() => {
    const cv = glCanvasRef.current;
    if (!cv) return;
    cv.width = cv.height = N;
    let ctx: GLContext | null = null;
    let programs: PipelinePrograms | null = null;
    try {
      ctx = createGLContext(cv);
      programs = createPipelinePrograms(ctx.gl);
      setGl({ ctx, programs, pipeline: new WienerPipeline(ctx, programs) });
    } catch (e) {
      setGlError(e instanceof Error ? e : new Error(String(e)));
    }
    return () => {
      if (ctx && programs) disposePipelinePrograms(ctx.gl, programs);
      if (ctx) disposeGLContext(ctx);
    };
  }, []);

  // Intended image (콘텐츠 기반, 캐시)
  const [intendedImg, setIntendedImg] = useState<Float32Array | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let img: Float32Array;
      try {
        if (contentType === 'text') img = buildSampleText(N);
        else if (contentType === 'photo') img = buildSamplePhoto(N);
        else if (contentType === 'upload' && uploadedFile)
          img = await loadUserImage(uploadedFile, N);
        else return;
        if (!cancelled) setIntendedImg(img);
      } catch (e) {
        console.warn('[preview] content load failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contentType, uploadedFile]);

  const F_intended = useMemo(() => {
    if (!intendedImg) return null;
    return fft2dPacked(intendedImg, N, false);
  }, [intendedImg]);

  // PSF + H per eye (캐시)
  const rx = (eye === 'od' ? profile.refraction?.od : profile.refraction?.os) as
    | EyeRefraction
    | undefined;
  const H = useMemo(() => {
    if (!rx) return null;
    const r = generatePSF(rx, { N, pupil_mm: 3.0 });
    const psfPacked = new Float32Array(N * N * 2);
    for (let i = 0; i < N * N; i++) psfPacked[i * 2] = r.psf[i];
    return fft2dPacked(psfPacked, N, false);
  }, [rx]);

  // ② User no VCD = IFFT(F · H)
  const userNoVCD = useMemo(() => {
    if (!F_intended || !H) return null;
    return fft2dPacked(mulComplexPacked(F_intended, H, N), N, true);
  }, [F_intended, H]);

  // ③/④ K-dependent: GPU Wiener
  const [displayed, setDisplayed] = useState<Float32Array | null>(null);
  const [userWithVCD, setUserWithVCD] = useState<Float32Array | null>(null);

  useEffect(() => {
    if (!gl || !F_intended || !H) {
      setDisplayed(null);
      setUserWithVCD(null);
      return;
    }
    const K = K_LEVELS[kLevel - 1].K;
    const { ctx, pipeline } = gl;
    const fImageTex = makeComplexTexture(ctx.gl, N, packComplexToRGBA(F_intended, N));
    const hTex = makeComplexTexture(ctx.gl, N, packComplexToRGBA(H, N));
    const dispTex = pipeline.wiener(fImageTex, hTex, K, N);
    const F_displayed = readComplex(ctx.gl, dispTex, N);
    ctx.gl.deleteTexture(dispTex);
    ctx.gl.deleteTexture(fImageTex);
    ctx.gl.deleteTexture(hTex);
    setDisplayed(fft2dPacked(F_displayed, N, true));
    setUserWithVCD(fft2dPacked(mulComplexPacked(F_displayed, H, N), N, true));
  }, [gl, F_intended, H, kLevel]);

  // RMS
  const errNoVCD =
    intendedImg && userNoVCD ? rmsRealDiff(intendedImg, userNoVCD, N) : 0;
  const errWithVCD =
    intendedImg && userWithVCD ? rmsRealDiff(intendedImg, userWithVCD, N) : 0;
  const improvement = errNoVCD > 0 ? (1 - errWithVCD / errNoVCD) * 100 : 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <canvas ref={glCanvasRef} hidden />
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold text-text">VCD 미리보기</h2>
        <div className="font-mono text-xs text-text-dim">
          OD: <span className="text-text">{fmtRx(profile.refraction?.od)}</span> · OS:{' '}
          <span className="text-text">{fmtRx(profile.refraction?.os)}</span>
        </div>
      </header>

      {glError && (
        <div className="mb-4 rounded-md border border-err/40 bg-err/5 p-3 text-sm text-err">
          WebGL 초기화 실패: {glError.message}
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-bg-elev p-3">
        <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
          {(['text', 'photo', 'upload'] as ContentType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setContentType(t)}
              className={[
                'px-3 py-1.5',
                contentType === t ? 'bg-accent text-bg' : 'bg-bg-elev-2 text-text hover:bg-bg-elev',
              ].join(' ')}
            >
              {t === 'text' ? '텍스트' : t === 'photo' ? '사진' : '업로드'}
            </button>
          ))}
        </div>

        {contentType === 'upload' && (
          <label className="cursor-pointer rounded-md border border-line bg-bg-elev-2 px-3 py-1 text-xs hover:border-accent">
            파일 선택
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUploadedFile(f);
              }}
            />
            {uploadedFile && <span className="ml-2 text-text-dim">{uploadedFile.name}</span>}
          </label>
        )}

        <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
          <button
            type="button"
            disabled={!odAvailable}
            onClick={() => setEye('od')}
            className={[
              'px-3 py-1.5',
              eye === 'od' ? 'bg-accent text-bg' : 'bg-bg-elev-2 text-text hover:bg-bg-elev',
              !odAvailable ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            OD
          </button>
          <button
            type="button"
            disabled={!osAvailable}
            onClick={() => setEye('os')}
            className={[
              'px-3 py-1.5',
              eye === 'os' ? 'bg-accent text-bg' : 'bg-bg-elev-2 text-text hover:bg-bg-elev',
              !osAvailable ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            OS
          </button>
        </div>
      </div>

      {/* 4 panels */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Panel caption="① 의도된 화면 (원본)" data={intendedImg} />
        <Panel caption="② 보정 없이 본 모습" data={userNoVCD} />
        <Panel caption="③ 디스플레이 출력 (Wiener pre-filter)" data={displayed} />
        <Panel caption="④ VCD 적용 후" data={userWithVCD} />
      </div>

      {/* K slider */}
      <div className="mb-4 rounded-md border border-line bg-bg-elev p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-text">
              {K_LEVELS[kLevel - 1].label}
            </div>
            <div className="text-xs text-text-dim">
              {K_LEVELS[kLevel - 1].sub} · K = {K_LEVELS[kLevel - 1].K.toExponential(0)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-dim">RMS 개선</div>
            <div
              className={[
                'font-mono text-lg',
                improvement >= 30 ? 'text-ok' : improvement >= 10 ? 'text-warn' : 'text-text-dim',
              ].join(' ')}
            >
              {(improvement >= 0 ? '+' : '') + improvement.toFixed(1)}%
            </div>
          </div>
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
        <div className="mt-1 flex justify-between text-[10px] text-text-dim">
          <span>선명함 강하게</span>
          <span>균형</span>
          <span>노이즈 적게</span>
        </div>
      </div>

      <p className="text-xs text-text-dim">
        ② 와 ④ 를 비교하세요. ④ 가 ① 에 더 가까우면 VCD가 효과를 내고 있는 것입니다.
      </p>
    </div>
  );
}

function fmtRx(e?: EyeRefraction | null): string {
  if (!e) return '--';
  const sph = (e.sph > 0 ? '+' : '') + e.sph.toFixed(2);
  const cyl = e.cyl.toFixed(2);
  return `${sph}/${cyl}×${e.axis}°`;
}

// ── Panel ─────────────────────────────────────────────
function Panel({ caption, data }: { caption: string; data: Float32Array | null }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (!data) {
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, N, N);
      return;
    }
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = Math.max(0, Math.min(1, data[i * 2]));
      const g = Math.round(v * 255);
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [data]);
  return (
    <figure className="m-0 flex flex-col items-center gap-1 rounded-md border border-line bg-bg-elev p-2">
      <canvas
        ref={cvRef}
        className="aspect-square w-full max-w-64 bg-black"
        style={{ imageRendering: 'pixelated' }}
      />
      <figcaption className="text-xs text-text-dim">{caption}</figcaption>
    </figure>
  );
}

// ── CPU helpers ───────────────────────────────────────
function rmsRealDiff(A: Float32Array, B: Float32Array, N: number): number {
  let s = 0;
  for (let i = 0; i < N * N; i++) {
    const d = A[i * 2] - B[i * 2];
    s += d * d;
  }
  return Math.sqrt(s / (N * N));
}

// ── Content builders ──────────────────────────────────
function buildSampleText(N: number): Float32Array {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c2 = cv.getContext('2d')!;
  c2.fillStyle = '#fff';
  c2.fillRect(0, 0, N, N);
  c2.fillStyle = '#000';
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  const rows = [
    { font: 0.18, text: 'E F P' },
    { font: 0.13, text: 'T O Z L' },
    { font: 0.09, text: 'P E C F D' },
    { font: 0.065, text: 'E D F C Z P' },
    { font: 0.045, text: 'F E L O P Z D' },
    { font: 0.032, text: 'D E F P O T E C' },
  ];
  let y = N * 0.1;
  for (const r of rows) {
    const px = Math.round(N * r.font);
    c2.font = 'bold ' + px + 'px sans-serif';
    c2.fillText(r.text, N / 2, y);
    y += px * 1.35;
  }
  return canvasToComplexGray(cv, N);
}

function buildSamplePhoto(N: number): Float32Array {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c2 = cv.getContext('2d')!;
  const sky = c2.createLinearGradient(0, 0, 0, N * 0.65);
  sky.addColorStop(0, '#bcd9f5');
  sky.addColorStop(0.7, '#f4e9c8');
  c2.fillStyle = sky;
  c2.fillRect(0, 0, N, N * 0.7);
  c2.fillStyle = '#ffffff';
  c2.beginPath();
  c2.arc(N * 0.78, N * 0.18, N * 0.07, 0, Math.PI * 2);
  c2.fill();
  c2.fillStyle = '#7a87a3';
  c2.beginPath();
  c2.moveTo(0, N * 0.55);
  c2.lineTo(N * 0.2, N * 0.4);
  c2.lineTo(N * 0.42, N * 0.5);
  c2.lineTo(N * 0.6, N * 0.36);
  c2.lineTo(N * 0.85, N * 0.48);
  c2.lineTo(N, N * 0.42);
  c2.lineTo(N, N * 0.55);
  c2.closePath();
  c2.fill();
  c2.fillStyle = '#3a4456';
  c2.beginPath();
  c2.moveTo(0, N * 0.7);
  c2.lineTo(N * 0.18, N * 0.48);
  c2.lineTo(N * 0.32, N * 0.6);
  c2.lineTo(N * 0.5, N * 0.42);
  c2.lineTo(N * 0.72, N * 0.55);
  c2.lineTo(N, N * 0.52);
  c2.lineTo(N, N * 0.7);
  c2.closePath();
  c2.fill();
  c2.fillStyle = '#506b3d';
  c2.fillRect(0, N * 0.7, N, N * 0.3);
  c2.fillStyle = '#c9a373';
  c2.fillRect(N * 0.4, N * 0.73, N * 0.16, N * 0.13);
  c2.fillStyle = '#7a3838';
  c2.beginPath();
  c2.moveTo(N * 0.38, N * 0.73);
  c2.lineTo(N * 0.48, N * 0.65);
  c2.lineTo(N * 0.58, N * 0.73);
  c2.closePath();
  c2.fill();
  c2.fillStyle = '#000';
  c2.font = 'bold ' + Math.round(N * 0.05) + 'px sans-serif';
  c2.fillText('SAMPLE', N * 0.07, N * 0.94);
  return canvasToComplexGray(cv, N);
}

function loadUserImage(file: File, N: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const c2 = cv.getContext('2d')!;
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, N, N);
        const sc = Math.min(N / img.width, N / img.height);
        const dw = img.width * sc;
        const dh = img.height * sc;
        const dx = (N - dw) / 2;
        const dy = (N - dh) / 2;
        c2.drawImage(img, dx, dy, dw, dh);
        resolve(canvasToComplexGray(cv, N));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function canvasToComplexGray(canvas: HTMLCanvasElement, N: number): Float32Array {
  const data = canvas.getContext('2d')!.getImageData(0, 0, N, N).data;
  const out = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    out[i * 2] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return out;
}


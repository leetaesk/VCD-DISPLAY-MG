import { useEffect, useRef, useState } from 'react';

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
import { fft2d } from '@/features/vcd/fft';
import { generatePSF, ifftshift2d, refractionToZernike } from '@/features/vcd/psf';
import { WienerPipeline } from '@/features/vcd/wienerPipeline';

/* ─────────────────────────────────────────────────────────
   WebGLTestPage — Debug page for FFT / Wiener stack.
   원본: vcd-display/vcd-app/js/webgl-test.js (간소화).

   - PASS/FAIL 테이블 (CPU 라운드트립, GPU 라운드트립, impulse spectrum,
     CPU↔GPU 일치, PSF 에너지 보존)
   - 시각 데모: 테스트 이미지 → Gaussian PSF로 blur → Wiener 복원 (K 슬라이더)
   ───────────────────────────────────────────────────────── */

const N = 64;
const SIGMA = 2.0;

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

function WebGLTestPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ctxState, setCtxState] = useState<{
    ctx: GLContext;
    programs: PipelinePrograms;
    pipeline: WienerPipeline;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // K slider — log scale [-5, -1]
  const [kSlider, setKSlider] = useState(40);
  const K = sliderToK(kSlider);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.width = cv.height = N;
    let ctx: GLContext | null = null;
    let programs: PipelinePrograms | null = null;
    try {
      ctx = createGLContext(cv);
      programs = createPipelinePrograms(ctx.gl);
      setCtxState({ ctx, programs, pipeline: new WienerPipeline(ctx, programs) });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
    return () => {
      if (ctx && programs) disposePipelinePrograms(ctx.gl, programs);
      if (ctx) disposeGLContext(ctx);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold text-text">WebGL 테스트 (디버그)</h2>
        <p className="text-text-dim text-sm">
          CPU/GPU FFT 일치, 임펄스 응답, Wiener 복원 디버그.
        </p>
      </header>

      <div
        className={[
          'mb-4 rounded-md border p-3 text-sm',
          error
            ? 'border-err/40 bg-err/5 text-err'
            : ctxState
              ? 'border-ok/40 bg-ok/5 text-ok'
              : 'border-line bg-bg-elev text-text-dim',
        ].join(' ')}
      >
        WebGL2 + EXT_color_buffer_float:{' '}
        {error ? `FAIL — ${error.message}` : ctxState ? 'OK' : '초기화 중…'}
      </div>

      {/* hidden GL canvas */}
      <canvas ref={canvasRef} hidden />

      {ctxState && <TestsSection ctx={ctxState.ctx} programs={ctxState.programs} pipeline={ctxState.pipeline} />}

      {ctxState && (
        <DemoSection
          pipeline={ctxState.pipeline}
          ctx={ctxState.ctx}
          K={K}
          kSlider={kSlider}
          onKSlider={setKSlider}
        />
      )}
    </div>
  );
}

export default WebGLTestPage;

function sliderToK(s: number): number {
  const t = s / 100;
  return Math.pow(10, -5 + 4 * t);
}

// ── Tests ─────────────────────────────────────────────
function TestsSection({
  pipeline,
  ctx,
}: {
  pipeline: WienerPipeline;
  ctx: GLContext;
  programs: PipelinePrograms;
}) {
  const [results, setResults] = useState<TestResult[]>([]);

  const runTests = () => {
    const out: TestResult[] = [];
    const orig = randomComplex(N, 42);

    // 1. CPU round-trip
    {
      const F = cpuFFT2D(orig, N, false);
      const f2 = cpuFFT2D(F, N, true);
      const err = maxAbsDiff(orig, f2);
      out.push({
        name: 'CPU round-trip (FFT→IFFT)',
        pass: err < 1e-6,
        detail: `max|err| = ${err.toExponential(2)}`,
      });
    }

    // 2. CPU impulse → flat spectrum
    {
      const d = impulseComplex(N);
      const F = cpuFFT2D(d, N, false);
      const mags = magnitudes(F);
      const sd = stdDev(mags);
      out.push({
        name: 'CPU impulse spectrum flat',
        pass: sd < 1e-10,
        detail: `σ(|F|) = ${sd.toExponential(2)}`,
      });
    }

    // 3. GPU round-trip
    {
      const F = gpuFFT2D(pipeline, ctx, orig, N, false);
      const f2 = gpuFFT2D(pipeline, ctx, F, N, true);
      const err = maxAbsDiff(orig, f2);
      out.push({
        name: 'GPU round-trip (FFT→IFFT)',
        pass: err < 5e-3,
        detail: `max|err| = ${err.toExponential(2)}`,
      });
    }

    // 4. GPU impulse → flat spectrum
    {
      const d = impulseComplex(N);
      const F = gpuFFT2D(pipeline, ctx, d, N, false);
      const mags = magnitudes(F);
      const sd = stdDev(mags);
      out.push({
        name: 'GPU impulse spectrum flat',
        pass: sd < 1e-3,
        detail: `σ(|F|) = ${sd.toExponential(2)}`,
      });
    }

    // 5. CPU↔GPU agreement
    {
      const cpu = cpuFFT2D(orig, N, false);
      const gpu = gpuFFT2D(pipeline, ctx, orig, N, false);
      const err = maxAbsDiff(cpu, gpu);
      out.push({
        name: 'CPU ↔ GPU forward FFT agree',
        pass: err < 5e-3,
        detail: `max|err| = ${err.toExponential(2)}`,
      });
    }

    // 6. M1: zero refraction → zero Zernike
    {
      const z = refractionToZernike({ sph: 0, cyl: 0, axis: 0 }, 3.0);
      const ok = Math.abs(z.c3) < 1e-10 && Math.abs(z.c4) < 1e-10 && Math.abs(z.c5) < 1e-10;
      out.push({
        name: 'M1: zero refraction → zero Zernike',
        pass: ok,
        detail: `c4 = ${z.c4.toExponential(2)}`,
      });
    }

    // 7. M1: −1D sphere → c4 ≈ +1.299 μm
    {
      const z = refractionToZernike({ sph: -1, cyl: 0, axis: 0 }, 3.0);
      const ok = Math.abs(z.c4 - 1.299) < 0.01;
      out.push({
        name: 'M1: −1D sphere → c₄ ≈ +1.30 μm',
        pass: ok,
        detail: `c4 = ${z.c4.toFixed(4)}`,
      });
    }

    // 8. ifftshift correctness + involution
    {
      const a = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      ifftshift2d(a, 4);
      const expected = [11, 12, 9, 10, 15, 16, 13, 14, 3, 4, 1, 2, 7, 8, 5, 6];
      let okShift = true;
      for (let i = 0; i < 16; i++) if (a[i] !== expected[i]) okShift = false;
      ifftshift2d(a, 4);
      const orig0 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
      let okIdent = true;
      for (let i = 0; i < 16; i++) if (a[i] !== orig0[i]) okIdent = false;
      out.push({
        name: 'M1: ifftshift correct + involution',
        pass: okShift && okIdent,
        detail: `shift=${okShift ? 'OK' : 'fail'}, twice=ident:${okIdent ? 'OK' : 'fail'}`,
      });
    }

    // 9. PSF energy conservation
    {
      const p64 = generatePSF({ sph: -2, cyl: -0.5, axis: 90 }, { N: 64 });
      const p256 = generatePSF({ sph: -2, cyl: -0.5, axis: 90 }, { N: 256 });
      let s64 = 0;
      let s256 = 0;
      for (let i = 0; i < 64 * 64; i++) s64 += p64.psf[i];
      for (let i = 0; i < 256 * 256; i++) s256 += p256.psf[i];
      const ok = Math.abs(s64 - 1) < 1e-5 && Math.abs(s256 - 1) < 1e-5;
      out.push({
        name: 'M1: PSF energy = 1 (64×64 & 256×256)',
        pass: ok,
        detail: `Σ64=${s64.toFixed(6)}, Σ256=${s256.toFixed(6)}`,
      });
    }

    setResults(out);
  };

  return (
    <section className="mb-6 rounded-md border border-line bg-bg-elev p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">단위 테스트</h3>
        <button
          type="button"
          onClick={runTests}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          실행 ▶
        </button>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-text-dim">실행 버튼을 눌러 테스트 수행.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-text-dim">
              <th className="py-1 pr-2">이름</th>
              <th className="py-1 pr-2">상세</th>
              <th className="py-1">결과</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2">
                  <span
                    aria-hidden
                    className={[
                      'mr-2 inline-block h-2 w-2 rounded-full',
                      r.pass ? 'bg-ok' : 'bg-err',
                    ].join(' ')}
                  />
                  {r.name}
                </td>
                <td className="py-1 pr-2 font-mono text-text-dim">{r.detail}</td>
                <td className={['py-1 font-mono', r.pass ? 'text-ok' : 'text-err'].join(' ')}>
                  {r.pass ? 'PASS' : 'FAIL'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Demo ──────────────────────────────────────────────
function DemoSection({
  pipeline,
  ctx,
  K,
  kSlider,
  onKSlider,
}: {
  pipeline: WienerPipeline;
  ctx: GLContext;
  K: number;
  kSlider: number;
  onKSlider: (n: number) => void;
}) {
  const origRef = useRef<HTMLCanvasElement | null>(null);
  const blurredRef = useRef<HTMLCanvasElement | null>(null);
  const psfRef = useRef<HTMLCanvasElement | null>(null);
  const restoredRef = useRef<HTMLCanvasElement | null>(null);
  const diffRef = useRef<HTMLCanvasElement | null>(null);

  // 데모 데이터 준비 — 한 번만
  const dataRef = useRef<{
    original: Float32Array;
    blurred: Float32Array;
    psf: Float32Array;
    F_blur: Float32Array;
    H: Float32Array;
  } | null>(null);

  useEffect(() => {
    const original = buildTestImage(N);
    const psf = buildPSF(N, SIGMA);
    const F_img = cpuFFT2D(original, N, false);
    const H = cpuFFT2D(psf, N, false);
    const FH = mulComplex(F_img, H, N);
    const blurred = cpuFFT2D(FH, N, true);
    const F_blur = cpuFFT2D(blurred, N, false);
    dataRef.current = { original, blurred, psf, F_blur, H };
    drawComplexReal(origRef.current!, original, N);
    drawComplexReal(blurredRef.current!, blurred, N);
    drawPSFShifted(psfRef.current!, psf, N);
  }, []);

  // K 바뀔 때마다 Wiener 재실행
  useEffect(() => {
    const d = dataRef.current;
    if (!d) return;
    const gl = ctx.gl;
    const fblurTex = makeComplexTexture(gl, N, packComplexToRGBA(d.F_blur, N));
    const hTex = makeComplexTexture(gl, N, packComplexToRGBA(d.H, N));
    const restoredTex = pipeline.wiener(fblurTex, hTex, K, N);
    const G = readComplex(gl, restoredTex, N);
    gl.deleteTexture(restoredTex);
    gl.deleteTexture(fblurTex);
    gl.deleteTexture(hTex);
    const restored = cpuFFT2D(G, N, true);
    drawComplexReal(restoredRef.current!, restored, N);
    const diff = new Float32Array(N * N * 2);
    for (let i = 0; i < N * N; i++) {
      diff[i * 2] = Math.abs(d.original[i * 2] - restored[i * 2]);
    }
    drawComplexReal(diffRef.current!, diff, N, 4);
  }, [K, pipeline, ctx]);

  return (
    <section className="rounded-md border border-line bg-bg-elev p-5">
      <h3 className="mb-3 text-lg font-semibold text-text">Wiener 복원 데모</h3>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <CanvasFig caption="원본" cvRef={origRef} />
        <CanvasFig caption={`Gaussian PSF σ=${SIGMA}`} cvRef={psfRef} />
        <CanvasFig caption="blur 결과" cvRef={blurredRef} />
        <CanvasFig caption="Wiener 복원" cvRef={restoredRef} />
        <CanvasFig caption="|원본 − 복원| ×4" cvRef={diffRef} />
      </div>

      <label className="flex items-center gap-3 text-sm">
        <span className="text-text-dim">K (regularization)</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={kSlider}
          onChange={(e) => onKSlider(Number(e.target.value))}
          className="w-64"
        />
        <span className="font-mono text-text">K = {K.toExponential(2)}</span>
      </label>
      <p className="mt-2 text-xs text-text-dim">
        K 작을수록 선명 (noise 증폭), K 클수록 부드러움 (선명도 손실).
      </p>
    </section>
  );
}

function CanvasFig({
  caption,
  cvRef,
}: {
  caption: string;
  cvRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas
        ref={cvRef}
        className="bg-black"
        style={{ width: 128, height: 128, imageRendering: 'pixelated' }}
      />
      <figcaption className="text-xs text-text-dim">{caption}</figcaption>
    </figure>
  );
}

// ── Helpers ───────────────────────────────────────────
function randomComplex(N: number, seed: number): Float32Array {
  let s = seed | 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
  const arr = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    arr[i * 2] = rng() * 2 - 1;
    arr[i * 2 + 1] = rng() * 2 - 1;
  }
  return arr;
}

function impulseComplex(N: number): Float32Array {
  const arr = new Float32Array(N * N * 2);
  arr[0] = 1;
  return arr;
}

function buildTestImage(N: number): Float32Array {
  const im = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) im[i * 2] = 0.05;
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x >= 0 && x < N && y >= 0 && y < N) im[(y * N + x) * 2] = v;
      }
    }
  };
  rect(8, 12, 3, 20, 0.92);
  rect(14, 12, 3, 20, 0.92);
  rect(8, 22, 9, 3, 0.92);
  const cx = 44;
  const cy = 22;
  const r = 7;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) im[(y * N + x) * 2] = 0.85;
    }
  }
  for (let y = 38; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x > y - 38) im[(y * N + x) * 2] = 0.7;
    }
  }
  return im;
}

function buildPSF(N: number, sigma: number): Float32Array {
  const psf = new Float32Array(N * N * 2);
  let sum = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x < N / 2 ? x : x - N;
      const dy = y < N / 2 ? y : y - N;
      const v = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      psf[(y * N + x) * 2] = v;
      sum += v;
    }
  }
  for (let i = 0; i < N * N; i++) psf[i * 2] /= sum;
  return psf;
}

function cpuFFT2D(packed: Float32Array, N: number, inverse: boolean): Float32Array {
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    re[i] = packed[i * 2];
    im[i] = packed[i * 2 + 1];
  }
  fft2d(re, im, N, inverse);
  const out = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    out[i * 2] = re[i];
    out[i * 2 + 1] = im[i];
  }
  return out;
}

function gpuFFT2D(
  pipeline: WienerPipeline,
  ctx: GLContext,
  packed: Float32Array,
  N: number,
  inverse: boolean,
): Float32Array {
  const gl = ctx.gl;
  const inTex = makeComplexTexture(gl, N, packComplexToRGBA(packed, N));
  const outTex = pipeline.fft2d(inTex, N, inverse);
  const result = readComplex(gl, outTex, N);
  if (inverse) WienerPipeline.inverseScale(result, N);
  gl.deleteTexture(inTex);
  gl.deleteTexture(outTex);
  return result;
}

function mulComplex(A: Float32Array, B: Float32Array, N: number): Float32Array {
  const out = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const ar = A[i * 2];
    const ai = A[i * 2 + 1];
    const br = B[i * 2];
    const bi = B[i * 2 + 1];
    out[i * 2] = ar * br - ai * bi;
    out[i * 2 + 1] = ar * bi + ai * br;
  }
  return out;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

function magnitudes(complex: Float32Array): Float32Array {
  const N2 = complex.length / 2;
  const m = new Float32Array(N2);
  for (let i = 0; i < N2; i++) m[i] = Math.hypot(complex[i * 2], complex[i * 2 + 1]);
  return m;
}

function stdDev(arr: Float32Array): number {
  let sum = 0;
  for (const v of arr) sum += v;
  const mean = sum / arr.length;
  let s = 0;
  for (const v of arr) s += (v - mean) * (v - mean);
  return Math.sqrt(s / arr.length);
}

function drawComplexReal(
  canvas: HTMLCanvasElement,
  complex: Float32Array,
  N: number,
  gain = 1,
) {
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = Math.max(0, Math.min(1, complex[i * 2] * gain));
    const g = Math.round(v * 255);
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function drawPSFShifted(canvas: HTMLCanvasElement, psf: Float32Array, N: number) {
  const shifted = new Float32Array(N * N * 2);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (x + N / 2) % N;
      const sy = (y + N / 2) % N;
      shifted[(y * N + x) * 2] = psf[(sy * N + sx) * 2];
    }
  }
  let maxV = 0;
  for (let i = 0; i < N * N; i++) maxV = Math.max(maxV, shifted[i * 2]);
  drawComplexReal(canvas, shifted, N, maxV > 0 ? 1 / maxV : 1);
}

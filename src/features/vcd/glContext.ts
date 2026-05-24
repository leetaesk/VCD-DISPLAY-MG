/* ─────────────────────────────────────────────────────────
   glContext.ts — WebGL2 컨텍스트 + 셰이더/프로그램 컴파일 + 텍스처/FBO 유틸.

   원본: vcd-display/vcd-app/js/vcd-shader.js의 GPU 부분.

   원본과의 차이:
   - 셰이더는 fetch 대신 ?raw 정적 임포트. 비동기 loadPrograms()가
     동기 createPipelinePrograms()로 단순해짐.
   - GLContext 객체가 init/dispose를 갖는 lifecycle 단위.
     dispose는 텍스처/프로그램/버퍼/컨텍스트(WEBGL_lose_context)까지 모두 해제.

   StrictMode 주의: 같은 캔버스에 init을 두 번 호출하지 말 것.
   훅(useWebGLPipeline)이 init→dispose→init을 보장하므로 누수 없음.
   ───────────────────────────────────────────────────────── */
import binocularBlendFrag from './shaders/binocular-blend.frag?raw';
import colorCorrectFrag from './shaders/color-correct.frag?raw';
import complexMulFrag from './shaders/complex-mul.frag?raw';
import fftFrag from './shaders/fft.frag?raw';
import grayPackFrag from './shaders/gray-pack.frag?raw';
import outputFrag from './shaders/output.frag?raw';
import vcdBlendFrag from './shaders/vcd-blend.frag?raw';
import wienerFrag from './shaders/wiener.frag?raw';
import wienerVert from './shaders/wiener.vert?raw';

export interface GLContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly quad: WebGLBuffer;
  /** WEBGL_lose_context 확장 — dispose에서 컨텍스트 명시 해제. */
  readonly loseExt: WEBGL_lose_context | null;
}

/**
 * 캔버스에 WebGL2 컨텍스트와 fullscreen quad VBO를 만든다.
 * EXT_color_buffer_float가 없거나, iOS Safari처럼 보고만 하고 실제 FBO
 * 생성에 실패하는 경우엔 throw — Wiener 파이프라인은 RGBA32F 필수.
 */
export function createGLContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('이 브라우저는 WebGL2를 지원하지 않습니다.');

  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    throw new Error(
      '이 기기는 RGBA32F 렌더 타깃(EXT_color_buffer_float)을 지원하지 않아 보정 파이프라인을 실행할 수 없습니다. 데스크탑 Chrome/Firefox/Edge에서 다시 시도해 주세요.',
    );
  }

  // 실제로 RGBA32F FBO가 완성되는지 프로브 — iOS Safari는 확장은 노출하지만
  // 실제 FBO 검사에서 GL_FRAMEBUFFER_UNSUPPORTED(0x8CDD)를 반환하는 경우가 있음.
  // 256×256까지 검사 — 앱에서 가장 큰 사이즈는 Preview/Camera의 256.
  // 4×4만 통과하고 64×64에서 막히는 모바일 GPU도 있어 실제 사용 크기로 확인.
  for (const probeN of [64, 256]) {
    if (!probeFloatFBO(gl, probeN)) {
      throw new Error(
        `이 기기는 ${probeN}×${probeN} RGBA32F 프레임버퍼를 만들지 못합니다. 보정 파이프라인이 동작하려면 데스크탑 Chrome/Firefox/Edge가 필요합니다.`,
      );
    }
  }

  const quad = gl.createBuffer();
  if (!quad) throw new Error('Failed to create quad VBO.');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    // 2 triangles covering [-1,1]^2 NDC
    new Float32Array([-1, -1, +1, -1, -1, +1, -1, +1, +1, -1, +1, +1]),
    gl.STATIC_DRAW,
  );

  return {
    gl,
    canvas,
    quad,
    loseExt: gl.getExtension('WEBGL_lose_context'),
  };
}

function probeFloatFBO(gl: WebGL2RenderingContext, N: number): boolean {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
  }
}

/** GLContext 자체와 부속 자원 해제. 호출 후 ctx는 사용 금지. */
export function disposeGLContext(ctx: GLContext): void {
  ctx.gl.deleteBuffer(ctx.quad);
  // 컨텍스트 명시 해제 — StrictMode double mount 등에서 누수 방지.
  ctx.loseExt?.loseContext();
}

// ── Shader / program compilation ───────────────────────
function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}\n--- src ---\n${src}`);
  }
  return sh;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_position');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

// ── Uniform location bundles ───────────────────────────
export interface FFTUniforms {
  u_src: WebGLUniformLocation | null;
  u_N: WebGLUniformLocation | null;
  u_span: WebGLUniformLocation | null;
  u_dir: WebGLUniformLocation | null;
  u_axis: WebGLUniformLocation | null;
}

export interface WienerUniforms {
  u_image_fft: WebGLUniformLocation | null;
  u_psf_fft: WebGLUniformLocation | null;
  u_K: WebGLUniformLocation | null;
}

export interface GrayPackUniforms {
  u_video: WebGLUniformLocation | null;
  u_videoAspect: WebGLUniformLocation | null;
  u_mirror: WebGLUniformLocation | null;
}

export interface OutputUniforms {
  u_src: WebGLUniformLocation | null;
  u_scale: WebGLUniformLocation | null;
}

export interface ComplexMulUniforms {
  u_a: WebGLUniformLocation | null;
  u_b: WebGLUniformLocation | null;
}

export interface VCDBlendUniforms {
  u_image_fft: WebGLUniformLocation | null;
  u_psf_fft: WebGLUniformLocation | null;
  u_K: WebGLUniformLocation | null;
  u_strength: WebGLUniformLocation | null;
}

export interface BinocularBlendUniforms {
  u_h_od: WebGLUniformLocation | null;
  u_h_os: WebGLUniformLocation | null;
  u_w_od: WebGLUniformLocation | null;
  u_w_os: WebGLUniformLocation | null;
}

export interface ColorCorrectUniforms {
  u_video: WebGLUniformLocation | null;
  u_defectMask: WebGLUniformLocation | null;
  u_videoAspect: WebGLUniformLocation | null;
  u_mirror: WebGLUniformLocation | null;
  u_colorMatrix: WebGLUniformLocation | null;
  u_remapStrength: WebGLUniformLocation | null;
}

export interface PipelinePrograms {
  fft: WebGLProgram;
  wiener: WebGLProgram;
  grayPack: WebGLProgram;
  output: WebGLProgram;
  complexMul: WebGLProgram;
  vcdBlend: WebGLProgram;
  binocularBlend: WebGLProgram;
  colorCorrect: WebGLProgram;

  fftU: FFTUniforms;
  wienerU: WienerUniforms;
  grayPackU: GrayPackUniforms;
  outputU: OutputUniforms;
  complexMulU: ComplexMulUniforms;
  vcdBlendU: VCDBlendUniforms;
  binocularBlendU: BinocularBlendUniforms;
  colorCorrectU: ColorCorrectUniforms;
}

/**
 * 9개 셰이더 → 8개 프로그램 + uniform location 캐시.
 * ?raw 정적 임포트라 비동기 불필요.
 */
export function createPipelinePrograms(gl: WebGL2RenderingContext): PipelinePrograms {
  const programs = {
    fft: linkProgram(gl, wienerVert, fftFrag),
    wiener: linkProgram(gl, wienerVert, wienerFrag),
    grayPack: linkProgram(gl, wienerVert, grayPackFrag),
    output: linkProgram(gl, wienerVert, outputFrag),
    complexMul: linkProgram(gl, wienerVert, complexMulFrag),
    vcdBlend: linkProgram(gl, wienerVert, vcdBlendFrag),
    binocularBlend: linkProgram(gl, wienerVert, binocularBlendFrag),
    colorCorrect: linkProgram(gl, wienerVert, colorCorrectFrag),
  };

  return {
    ...programs,
    fftU: {
      u_src: gl.getUniformLocation(programs.fft, 'u_src'),
      u_N: gl.getUniformLocation(programs.fft, 'u_N'),
      u_span: gl.getUniformLocation(programs.fft, 'u_span'),
      u_dir: gl.getUniformLocation(programs.fft, 'u_dir'),
      u_axis: gl.getUniformLocation(programs.fft, 'u_axis'),
    },
    wienerU: {
      u_image_fft: gl.getUniformLocation(programs.wiener, 'u_image_fft'),
      u_psf_fft: gl.getUniformLocation(programs.wiener, 'u_psf_fft'),
      u_K: gl.getUniformLocation(programs.wiener, 'u_K'),
    },
    grayPackU: {
      u_video: gl.getUniformLocation(programs.grayPack, 'u_video'),
      u_videoAspect: gl.getUniformLocation(programs.grayPack, 'u_videoAspect'),
      u_mirror: gl.getUniformLocation(programs.grayPack, 'u_mirror'),
    },
    outputU: {
      u_src: gl.getUniformLocation(programs.output, 'u_src'),
      u_scale: gl.getUniformLocation(programs.output, 'u_scale'),
    },
    complexMulU: {
      u_a: gl.getUniformLocation(programs.complexMul, 'u_a'),
      u_b: gl.getUniformLocation(programs.complexMul, 'u_b'),
    },
    vcdBlendU: {
      u_image_fft: gl.getUniformLocation(programs.vcdBlend, 'u_image_fft'),
      u_psf_fft: gl.getUniformLocation(programs.vcdBlend, 'u_psf_fft'),
      u_K: gl.getUniformLocation(programs.vcdBlend, 'u_K'),
      u_strength: gl.getUniformLocation(programs.vcdBlend, 'u_strength'),
    },
    binocularBlendU: {
      u_h_od: gl.getUniformLocation(programs.binocularBlend, 'u_h_od'),
      u_h_os: gl.getUniformLocation(programs.binocularBlend, 'u_h_os'),
      u_w_od: gl.getUniformLocation(programs.binocularBlend, 'u_w_od'),
      u_w_os: gl.getUniformLocation(programs.binocularBlend, 'u_w_os'),
    },
    colorCorrectU: {
      u_video: gl.getUniformLocation(programs.colorCorrect, 'u_video'),
      u_defectMask: gl.getUniformLocation(programs.colorCorrect, 'u_defectMask'),
      u_videoAspect: gl.getUniformLocation(programs.colorCorrect, 'u_videoAspect'),
      u_mirror: gl.getUniformLocation(programs.colorCorrect, 'u_mirror'),
      u_colorMatrix: gl.getUniformLocation(programs.colorCorrect, 'u_colorMatrix'),
      u_remapStrength: gl.getUniformLocation(programs.colorCorrect, 'u_remapStrength'),
    },
  };
}

/** 프로그램 8개 전부 해제. */
export function disposePipelinePrograms(
  gl: WebGL2RenderingContext,
  p: PipelinePrograms,
): void {
  gl.deleteProgram(p.fft);
  gl.deleteProgram(p.wiener);
  gl.deleteProgram(p.grayPack);
  gl.deleteProgram(p.output);
  gl.deleteProgram(p.complexMul);
  gl.deleteProgram(p.vcdBlend);
  gl.deleteProgram(p.binocularBlend);
  gl.deleteProgram(p.colorCorrect);
}

// ── Texture / FBO utilities ────────────────────────────
/**
 * N×N RGBA32F 텍스처. data가 있으면 업로드(Float32Array length = N*N*4, RGBA).
 * 복소수는 RG에 저장, BA는 컨벤션상 (0, 1).
 */
export function makeComplexTexture(
  gl: WebGL2RenderingContext,
  N: number,
  data?: Float32Array | null,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, data ?? null);
  return tex;
}

export function makeFBO(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return fbo;
}

/** 복소 배열 [re, im, re, im, ...] (length = N*N*2) → Float32 RGBA (length = N*N*4). */
export function packComplexToRGBA(complex: Float32Array, N: number): Float32Array {
  const out = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4 + 0] = complex[i * 2 + 0];
    out[i * 4 + 1] = complex[i * 2 + 1];
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** 텍스처에서 복소 배열 readback. 임시 FBO 사용. */
export function readComplex(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  N: number,
): Float32Array {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const rgba = new Float32Array(N * N * 4);
  gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, rgba);
  gl.deleteFramebuffer(fbo);
  const out = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    out[i * 2] = rgba[i * 4];
    out[i * 2 + 1] = rgba[i * 4 + 1];
  }
  return out;
}

// ── Rendering primitive ────────────────────────────────
export function bindQuad(ctx: GLContext): void {
  const { gl } = ctx;
  gl.bindBuffer(gl.ARRAY_BUFFER, ctx.quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

export function drawTo(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  N: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, N, N);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

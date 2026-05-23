/* ─────────────────────────────────────────────────────────
   cameraPipeline.ts — Per-frame VCD pipeline for camera page.

   원본: camera-correction.js의 Pipeline class.

   소유 자원 (해상도 N 고정):
     - videoTex (RGBA8): 비디오 업로드 대상
     - grayTex (RGBA32F): grayPack 결과
     - fftA / fftB (RGBA32F): FFT ping-pong
     - blurTex (RGBA32F): vcd-blend 결과
     - hOdTex / hOsTex / hBlendedTex (RGBA32F): FFT(PSF) per eye
     - 각각 FBO

   해상도 변경 시 destroy() 후 재생성.
   ───────────────────────────────────────────────────────── */
import {
  bindQuad,
  drawTo,
  makeComplexTexture,
  makeFBO,
  packComplexToRGBA,
  type GLContext,
  type PipelinePrograms,
} from './glContext';

export type CameraMode = 'od' | 'os' | 'binocular';

export interface FrameTimings {
  upload: number;
  grayPack: number;
  fft: number;
  binoBlend: number;
  vcdBlend: number;
  ifft: number;
  output: number;
}

export class CameraPipeline {
  readonly N: number;
  private readonly ctx: GLContext;
  private readonly programs: PipelinePrograms;

  private readonly videoTex: WebGLTexture;
  private readonly grayTex: WebGLTexture;
  private readonly fftA: WebGLTexture;
  private readonly fftB: WebGLTexture;
  private readonly blurTex: WebGLTexture;
  private readonly hOdTex: WebGLTexture;
  private readonly hOsTex: WebGLTexture;
  private readonly hBlendedTex: WebGLTexture;

  private readonly grayFBO: WebGLFramebuffer;
  private readonly fftAFBO: WebGLFramebuffer;
  private readonly fftBFBO: WebGLFramebuffer;
  private readonly blurFBO: WebGLFramebuffer;
  private readonly hBlendedFBO: WebGLFramebuffer;

  constructor(ctx: GLContext, programs: PipelinePrograms, N: number) {
    this.ctx = ctx;
    this.programs = programs;
    this.N = N;
    const gl = ctx.gl;

    // 비디오 텍스처는 RGBA8 — 사이즈는 첫 업로드에서 결정.
    const vt = gl.createTexture();
    if (!vt) throw new Error('createTexture failed (videoTex)');
    this.videoTex = vt;
    gl.bindTexture(gl.TEXTURE_2D, vt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.grayTex = makeComplexTexture(gl, N);
    this.fftA = makeComplexTexture(gl, N);
    this.fftB = makeComplexTexture(gl, N);
    this.blurTex = makeComplexTexture(gl, N);
    this.hOdTex = makeComplexTexture(gl, N);
    this.hOsTex = makeComplexTexture(gl, N);
    this.hBlendedTex = makeComplexTexture(gl, N);

    this.grayFBO = makeFBO(gl, this.grayTex);
    this.fftAFBO = makeFBO(gl, this.fftA);
    this.fftBFBO = makeFBO(gl, this.fftB);
    this.blurFBO = makeFBO(gl, this.blurTex);
    this.hBlendedFBO = makeFBO(gl, this.hBlendedTex);
  }

  uploadHOd(packed: Float32Array): void {
    this.uploadComplex(this.hOdTex, packed);
  }
  uploadHOs(packed: Float32Array): void {
    this.uploadComplex(this.hOsTex, packed);
  }
  private uploadComplex(tex: WebGLTexture, packed: Float32Array): void {
    const gl = this.ctx.gl;
    const rgba = packComplexToRGBA(packed, this.N);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.N, this.N, gl.RGBA, gl.FLOAT, rgba);
  }

  renderFrame(
    video: HTMLVideoElement,
    K: number,
    mode: CameraMode,
    weights: { od: number; os: number },
    strength: number,
    mirror: boolean,
    timings: FrameTimings,
  ): void {
    const gl = this.ctx.gl;
    const N = this.N;

    // 1. video → videoTex
    const t1 = performance.now();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    timings.upload = performance.now() - t1;

    // 2. grayPack
    const t2 = performance.now();
    gl.useProgram(this.programs.grayPack);
    bindQuad(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.uniform1i(this.programs.grayPackU.u_video, 0);
    gl.uniform1f(
      this.programs.grayPackU.u_videoAspect,
      video.videoWidth / video.videoHeight,
    );
    gl.uniform1f(this.programs.grayPackU.u_mirror, mirror ? 1.0 : 0.0);
    drawTo(gl, this.grayFBO, N);
    timings.grayPack = performance.now() - t2;

    // 3. FFT(gray) → F
    const t3 = performance.now();
    const Ftex = this.fft2dPingPong(this.grayTex, false);
    timings.fft = performance.now() - t3;

    // 4. select / build H
    let hTex: WebGLTexture;
    let binoMs = 0;
    if (mode === 'binocular') {
      const tBino = performance.now();
      this.runBinocularBlend(weights.od, weights.os);
      binoMs = performance.now() - tBino;
      hTex = this.hBlendedTex;
    } else if (mode === 'os') {
      hTex = this.hOsTex;
    } else {
      hTex = this.hOdTex;
    }
    timings.binoBlend = binoMs;

    // 5. vcd-blend → blurTex
    const t5 = performance.now();
    this.runVcdBlend(Ftex, hTex, K, strength, this.blurFBO);
    timings.vcdBlend = performance.now() - t5;

    // 6. inverse FFT
    const t6 = performance.now();
    const ITex = this.fft2dPingPong(this.blurTex, true);
    timings.ifft = performance.now() - t6;

    // 7. output
    const t7 = performance.now();
    this.runOutput(ITex, 1.0 / (N * N));
    timings.output = performance.now() - t7;
  }

  destroy(): void {
    const gl = this.ctx.gl;
    [
      this.videoTex,
      this.grayTex,
      this.fftA,
      this.fftB,
      this.blurTex,
      this.hOdTex,
      this.hOsTex,
      this.hBlendedTex,
    ].forEach((t) => gl.deleteTexture(t));
    [this.grayFBO, this.fftAFBO, this.fftBFBO, this.blurFBO, this.hBlendedFBO].forEach((f) =>
      gl.deleteFramebuffer(f),
    );
  }

  // ── private ───────────────────────────────────────────
  private fft2dPingPong(srcTex: WebGLTexture, inverse: boolean): WebGLTexture {
    const gl = this.ctx.gl;
    const N = this.N;
    const dir = inverse ? +1 : -1;
    const stages = Math.log2(N) | 0;
    const { fft, fftU } = this.programs;

    gl.useProgram(fft);
    bindQuad(this.ctx);
    gl.uniform1f(fftU.u_N, N);
    gl.uniform1f(fftU.u_dir, dir);

    let read = srcTex;
    let writeTex: WebGLTexture = this.fftA;
    let writeFBO: WebGLFramebuffer = this.fftAFBO;
    let otherTex: WebGLTexture = this.fftB;
    let otherFBO: WebGLFramebuffer = this.fftBFBO;

    for (let axis = 0; axis < 2; axis++) {
      gl.uniform1i(fftU.u_axis, axis);
      for (let s = 0; s < stages; s++) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, read);
        gl.uniform1i(fftU.u_src, 0);
        gl.uniform1f(fftU.u_span, Math.pow(2, s));
        drawTo(gl, writeFBO, N);
        read = writeTex;
        const tt = writeTex;
        writeTex = otherTex;
        otherTex = tt;
        const ff = writeFBO;
        writeFBO = otherFBO;
        otherFBO = ff;
      }
    }
    return read;
  }

  private runVcdBlend(
    fTex: WebGLTexture,
    hTex: WebGLTexture,
    K: number,
    strength: number,
    outFBO: WebGLFramebuffer,
  ): void {
    const gl = this.ctx.gl;
    const { vcdBlend, vcdBlendU } = this.programs;
    gl.useProgram(vcdBlend);
    bindQuad(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fTex);
    gl.uniform1i(vcdBlendU.u_image_fft, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hTex);
    gl.uniform1i(vcdBlendU.u_psf_fft, 1);
    gl.uniform1f(vcdBlendU.u_K, K);
    gl.uniform1f(vcdBlendU.u_strength, strength);
    drawTo(gl, outFBO, this.N);
  }

  private runBinocularBlend(wOd: number, wOs: number): void {
    const gl = this.ctx.gl;
    const { binocularBlend, binocularBlendU } = this.programs;
    gl.useProgram(binocularBlend);
    bindQuad(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hOdTex);
    gl.uniform1i(binocularBlendU.u_h_od, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hOsTex);
    gl.uniform1i(binocularBlendU.u_h_os, 1);
    gl.uniform1f(binocularBlendU.u_w_od, wOd);
    gl.uniform1f(binocularBlendU.u_w_os, wOs);
    drawTo(gl, this.hBlendedFBO, this.N);
  }

  private runOutput(srcTex: WebGLTexture, scale: number): void {
    const gl = this.ctx.gl;
    const { output, outputU } = this.programs;
    gl.useProgram(output);
    bindQuad(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(outputU.u_src, 0);
    gl.uniform1f(outputU.u_scale, scale);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

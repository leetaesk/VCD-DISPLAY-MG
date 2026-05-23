/* ─────────────────────────────────────────────────────────
   wienerPipeline.ts — Stockham FFT ping-pong + Wiener pass.

   원본: vcd-display/vcd-app/js/vcd-shader.js의 fft2dGPU / wienerGPU /
   inverseScale.

   설계:
   - GLContext + PipelinePrograms를 외부에서 주입받음 (DI).
   - init() / dispose() 대신 생성자 / dispose() 구조.
     ping-pong 텍스처는 한 번 만들어두고 재사용하지 않고 매 FFT마다
     일회용으로 생성/삭제 (원본 동작 유지). 호출자가 결과 텍스처
     소유권을 받음 — 다 쓰면 gl.deleteTexture로 직접 해제.

   왜 ping-pong 텍스처를 재사용 안 하나:
   - 결과 텍스처를 caller가 들고 다른 패스에 입력으로 쓰는 패턴이라
     매 호출마다 소유권 이전이 명확해야 함.
   - 64x64 RGBA32F = 64KB. 매 프레임 생성/삭제해도 부담 미미.
   ───────────────────────────────────────────────────────── */
import {
  bindQuad,
  drawTo,
  makeComplexTexture,
  makeFBO,
  type GLContext,
  type PipelinePrograms,
} from './glContext';

export class WienerPipeline {
  private readonly ctx: GLContext;
  private readonly programs: PipelinePrograms;

  constructor(ctx: GLContext, programs: PipelinePrograms) {
    this.ctx = ctx;
    this.programs = programs;
  }

  /**
   * 2D FFT를 srcTex (N×N, RGBA32F)에 수행. 새 텍스처 반환.
   * 호출자가 소유권 — 다 쓰면 gl.deleteTexture로 해제.
   *
   * 알고리즘: log2(N) row 패스 + log2(N) column 패스.
   * inverse=true는 twiddle 부호 반전 + 1/N² 스케일은 readback 시 별도
   * (inverseScale 함수 또는 호출자가 처리).
   */
  fft2d(srcTex: WebGLTexture, N: number, inverse: boolean): WebGLTexture {
    const { gl } = this.ctx;
    const { fft, fftU } = this.programs;
    const dir = inverse ? +1 : -1;

    // Two ping-pong textures + FBOs
    const texA = makeComplexTexture(gl, N);
    const texB = makeComplexTexture(gl, N);
    const fboA = makeFBO(gl, texA);
    const fboB = makeFBO(gl, texB);

    gl.useProgram(fft);
    bindQuad(this.ctx);
    gl.uniform1f(fftU.u_N, N);
    gl.uniform1f(fftU.u_dir, dir);

    const stages = Math.log2(N) | 0;
    let readTex = srcTex;
    let writeFBO: WebGLFramebuffer = fboA;
    let writeTex: WebGLTexture = texA;
    let otherFBO: WebGLFramebuffer = fboB;
    let otherTex: WebGLTexture = texB;

    // Row passes (axis 0)
    gl.uniform1i(fftU.u_axis, 0);
    for (let s = 0; s < stages; s++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(fftU.u_src, 0);
      gl.uniform1f(fftU.u_span, Math.pow(2, s));
      drawTo(gl, writeFBO, N);

      readTex = writeTex;
      [writeFBO, otherFBO] = [otherFBO, writeFBO];
      [writeTex, otherTex] = [otherTex, writeTex];
    }

    // Column passes (axis 1)
    gl.uniform1i(fftU.u_axis, 1);
    for (let s = 0; s < stages; s++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(fftU.u_src, 0);
      gl.uniform1f(fftU.u_span, Math.pow(2, s));
      drawTo(gl, writeFBO, N);

      readTex = writeTex;
      [writeFBO, otherFBO] = [otherFBO, writeFBO];
      [writeTex, otherTex] = [otherTex, writeTex];
    }

    // readTex가 결과. 나머지 ping-pong 자원 정리.
    if (readTex === texA) {
      gl.deleteFramebuffer(fboA);
      gl.deleteFramebuffer(fboB);
      gl.deleteTexture(texB);
    } else {
      gl.deleteFramebuffer(fboA);
      gl.deleteFramebuffer(fboB);
      gl.deleteTexture(texA);
    }
    return readTex;
  }

  /**
   * Wiener 필터:  F̃_out = F̃_in × conj(H) / (|H|² + K).
   * fImageTex / hPsfTex 모두 FFT된 복소 텍스처.
   * 호출자가 결과 텍스처 소유권.
   */
  wiener(
    fImageTex: WebGLTexture,
    hPsfTex: WebGLTexture,
    K: number,
    N: number,
  ): WebGLTexture {
    const { gl } = this.ctx;
    const { wiener, wienerU } = this.programs;

    const outTex = makeComplexTexture(gl, N);
    const outFBO = makeFBO(gl, outTex);

    gl.useProgram(wiener);
    bindQuad(this.ctx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fImageTex);
    gl.uniform1i(wienerU.u_image_fft, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hPsfTex);
    gl.uniform1i(wienerU.u_psf_fft, 1);
    gl.uniform1f(wienerU.u_K, K);

    drawTo(gl, outFBO, N);
    gl.deleteFramebuffer(outFBO);
    return outTex;
  }

  /**
   * IFFT의 1/N² 스케일을 CPU에서 적용. fft2d(inverse=true) 결과를
   * readback한 뒤 호출.
   */
  static inverseScale(arr: Float32Array, N: number): Float32Array {
    const s = 1 / (N * N);
    for (let i = 0; i < arr.length; i++) arr[i] *= s;
    return arr;
  }
}

import { useEffect, useState, type RefObject } from 'react';

import {
  createGLContext,
  createPipelinePrograms,
  disposeGLContext,
  disposePipelinePrograms,
  type GLContext,
  type PipelinePrograms,
} from '@/features/vcd/glContext';
import { WienerPipeline } from '@/features/vcd/wienerPipeline';

/**
 * useWebGLPipeline — 캔버스 ref를 받아 WebGL2 컨텍스트 + 8개 프로그램 +
 * Wiener 파이프라인을 lifecycle에 맞춰 init/dispose.
 *
 * StrictMode 안전성:
 *   - dev에서 useEffect가 mount → cleanup → mount로 두 번 호출됨.
 *   - 첫 cleanup이 모든 GL 리소스(프로그램·텍스처·버퍼·FBO) +
 *     컨텍스트(WEBGL_lose_context)까지 해제하므로 두 번째 mount는
 *     완전히 fresh한 상태에서 시작 → 누수 없음.
 *   - "ref-가드로 두 번째 init을 막는" 패턴은 일부러 안 씀. cleanup이
 *     떳떳하게 동작하면 굳이 가드할 이유가 없고, 가드하면 prod에서
 *     캔버스 교체 시 재초기화가 막힘.
 *
 * 실패 시:
 *   - WebGL2 미지원, EXT_color_buffer_float 부재, 셰이더 컴파일 실패
 *     등은 모두 createGLContext / createPipelinePrograms가 throw.
 *   - 훅은 `error` 상태로 노출 — 호출자가 ErrorBoundary 또는 fallback UI로 표시.
 */
export interface WebGLPipelineHandle {
  ctx: GLContext;
  programs: PipelinePrograms;
  pipeline: WienerPipeline;
}

export interface UseWebGLPipelineResult {
  handle: WebGLPipelineHandle | null;
  error: Error | null;
}

export function useWebGLPipeline(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): UseWebGLPipelineResult {
  const [handle, setHandle] = useState<WebGLPipelineHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: GLContext | null = null;
    let programs: PipelinePrograms | null = null;

    try {
      ctx = createGLContext(canvas);
      programs = createPipelinePrograms(ctx.gl);
      const pipeline = new WienerPipeline(ctx, programs);
      setHandle({ ctx, programs, pipeline });
      setError(null);
    } catch (e) {
      // 부분 성공 시 정리
      if (ctx && programs) disposePipelinePrograms(ctx.gl, programs);
      if (ctx) disposeGLContext(ctx);
      ctx = null;
      programs = null;
      setHandle(null);
      setError(e instanceof Error ? e : new Error(String(e)));
    }

    return () => {
      if (ctx && programs) disposePipelinePrograms(ctx.gl, programs);
      if (ctx) disposeGLContext(ctx);
      setHandle(null);
    };
  }, [canvasRef]);

  return { handle, error };
}

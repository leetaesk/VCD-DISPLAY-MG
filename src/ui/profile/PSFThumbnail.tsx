import { useEffect, useRef } from 'react';

import { generatePSF, type RefractionRx } from '@/features/vcd/psf';

interface Props {
  rx: RefractionRx | null;
  label: string;
  N?: number;
}

/**
 * Refraction → PSF → 64×64 canvas (sqrt-스트레치, fftshift로 가운데에 peak).
 * rx가 null이면 빈 캔버스 + "미측정".
 */
function PSFThumbnail({ rx, label, N = 64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captionRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const cap = captionRef.current;
    if (!cv || !cap) return;
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    if (!rx) {
      ctx.clearRect(0, 0, N, N);
      cap.textContent = `${label} (미측정)`;
      cv.style.opacity = '0.3';
      return;
    }

    const { psf } = generatePSF(rx, { N });
    const img = ctx.createImageData(N, N);
    const half = N / 2;
    let max = 0;
    for (let i = 0; i < N * N; i++) if (psf[i] > max) max = psf[i];
    const inv = max > 0 ? 1 / max : 1;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const sx = (x + half) % N;
        const sy = (y + half) % N;
        const v = Math.sqrt(Math.max(0, psf[sy * N + sx] * inv));
        const g = Math.round(v * 255);
        const j = (y * N + x) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = g;
        img.data[j + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    let sum = 0;
    for (const v of psf) sum += v;
    cap.textContent = `${label} · 정점 ${(psf[0] * 100).toFixed(2)}% · sum=${sum.toFixed(3)}`;
    cv.style.opacity = '1';
  }, [rx, label, N]);

  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        className="bg-bg-elev-2"
        style={{ width: 128, height: 128, imageRendering: 'pixelated' }}
      />
      <figcaption ref={captionRef} className="font-mono text-xs text-text-dim" />
    </figure>
  );
}

export default PSFThumbnail;

import { Link } from 'react-router-dom';

import { ROUTES } from '@/constants/routes';
import { useProfile } from '@/store/profileStore';

/* ─────────────────────────────────────────────────────────
   홈 화면 — 권장 흐름 안내 + 다음 단계 CTA.
   ProfileStore의 슬라이스 존재 여부를 보고 다음에 할 일을 추천.
   ───────────────────────────────────────────────────────── */
function HomePage() {
  const p = useProfile();

  const next = !p.calibration
    ? { route: ROUTES.calibration, cta: '캘리브레이션 시작', step: '1단계' }
    : !p.refraction
      ? { route: ROUTES.refraction, cta: '굴절 검사 시작', step: '2단계' }
      : !p.logmar
        ? { route: ROUTES.vision, cta: 'LogMAR 시력 검사', step: '3단계 (선택)' }
        : !p.csf_curve
          ? { route: ROUTES.csf, cta: '대비 민감도 검사', step: '4단계 (선택)' }
          : { route: ROUTES.preview, cta: 'VCD 미리보기', step: '체험' };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-2 text-2xl font-semibold text-text">
        VCD — 시야보정 디스플레이
      </h1>
      <p className="mb-6 text-text-dim">
        굴절 이상(근시·난시 등)을 측정해 WebGL Wiener 필터로 화면을 실시간 보정합니다.
        먼저 캘리브레이션 → 굴절 검사 순으로 진행하세요.
      </p>

      <div className="mb-8 rounded-md border border-accent/40 bg-linear-to-br from-accent/10 to-accent-2/5 p-5">
        <div className="mb-1 text-xs uppercase tracking-widest text-accent">
          다음 단계 {next.step}
        </div>
        <Link
          to={next.route}
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          {next.cta} →
        </Link>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-text-dim">
        권장 흐름
      </h2>
      <ol className="ml-5 list-decimal space-y-1 text-sm text-text">
        <li>캘리브레이션 (PPI, 시청 거리)</li>
        <li>굴절 추정 (SPH/CYL/AXIS)</li>
        <li>(선택) LogMAR 시력 → CSF → 색각 → Amsler</li>
        <li>시력 프로파일 확인 → VCD 미리보기 / 카메라 보정 체험</li>
      </ol>
    </div>
  );
}

export default HomePage;

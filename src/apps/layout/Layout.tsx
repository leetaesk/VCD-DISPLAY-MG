import { NavLink, Outlet } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import { ROUTES } from '@/constants/routes';
import { useProfile } from '@/store/profileStore';
import type { VCDProfile } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   사이드바 + 메인 영역.
   - 권장 흐름(캘리브레이션 → 굴절 → 선택검사 → 프로파일/프리뷰)을 그룹 순서로 반영.
   - 완료 뱃지: profile store에서 슬라이스 존재 여부로 도출.
   - <Outlet />은 ErrorBoundary로 감싸서 페이지 단위 에러를 흡수.
   ───────────────────────────────────────────────────────── */

type NavItem = {
  to: string;
  label: string;
  /** 완료 여부 판정 — profile에서 도출 */
  done?: (p: VCDProfile) => boolean;
};

type NavGroup = {
  heading: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    heading: '시작',
    items: [{ to: ROUTES.home, label: '홈' }],
  },
  {
    heading: '측정',
    items: [
      { to: ROUTES.calibration, label: '캘리브레이션', done: (p) => p.calibration !== null },
      { to: ROUTES.refraction, label: '굴절 추정', done: (p) => p.refraction !== null },
      { to: ROUTES.vision, label: 'LogMAR 시력', done: (p) => p.logmar !== null },
      { to: ROUTES.csf, label: '대비 민감도', done: (p) => p.csf_curve !== null },
      { to: ROUTES.color, label: '색각', done: (p) => p.color_vision !== null },
      {
        to: ROUTES.amsler,
        label: 'Amsler 시야',
        done: (p) => p.amsler_map_od !== null || p.amsler_map_os !== null,
      },
    ],
  },
  {
    heading: '결과 / 체험',
    items: [
      { to: ROUTES.profile, label: '시력 프로파일' },
      { to: ROUTES.preview, label: 'VCD 미리보기' },
      { to: ROUTES.camera, label: '카메라 보정' },
    ],
  },
  {
    heading: '디버그',
    items: [{ to: ROUTES.webglTest, label: 'WebGL 테스트' }],
  },
];

function Layout() {
  const profile = useProfile();

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      <aside className="flex flex-col overflow-y-auto border-r border-line bg-bg-elev">
        <div className="px-5 py-4 text-sm font-semibold tracking-widest text-accent">VCD</div>

        <nav className="flex-1 px-2 pb-4">
          {GROUPS.map((group) => (
            <div key={group.heading} className="mb-3">
              <div className="px-3 py-1 text-[11px] uppercase tracking-widest text-muted">
                {group.heading}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === ROUTES.home}
                      className={({ isActive }) =>
                        [
                          'flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-accent/10 text-text'
                            : 'text-text-dim hover:bg-bg-elev-2 hover:text-text',
                        ].join(' ')
                      }
                    >
                      <span>{item.label}</span>
                      {item.done && (
                        <span
                          aria-label={item.done(profile) ? '완료' : '미완료'}
                          className={[
                            'h-2 w-2 rounded-full',
                            item.done(profile) ? 'bg-ok' : 'bg-muted',
                          ].join(' ')}
                        />
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="overflow-y-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default Layout;

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import ErrorBoundary from '@/components/ErrorBoundary';
import { ROUTES } from '@/constants/routes';
import { useProfile, useProfileStore } from '@/store/profileStore';
import type { VCDProfile } from '@/types/profile';

/* ─────────────────────────────────────────────────────────
   사이드바 + 메인 영역.
   - 데스크탑(≥md): 240px 고정 사이드바
   - 모바일(<md): 상단 앱바 + 햄버거로 토글되는 drawer
   - 라우트 변경 시 drawer 자동 닫힘, ESC/백드롭 닫힘
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

function SidebarContent({ profile, onNavigate }: { profile: VCDProfile; onNavigate?: () => void }) {
  const reset = useProfileStore((s) => s.reset);

  const handleReset = () => {
    const ok = window.confirm(
      '⚠️ 모든 측정 데이터를 삭제합니다.\n\n이 작업은 되돌릴 수 없습니다.\n계속하시겠습니까?',
    );
    if (!ok) return;
    reset();
    onNavigate?.();
  };

  return (
    <>
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
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      [
                        'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[13px] transition-colors md:py-1.5',
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

      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={handleReset}
          className="flex w-full items-center gap-2 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-[13px] text-err transition-colors hover:bg-err/10"
        >
          <span aria-hidden>⚠️</span>
          <span>프로파일 초기화</span>
        </button>
      </div>
    </>
  );
}

function Layout() {
  const profile = useProfile();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-full flex-col md:grid md:grid-cols-[240px_1fr]">
      {/* 모바일 상단 앱바 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg-elev px-3 md:hidden">
        <button
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-dim hover:bg-bg-elev-2 hover:text-text"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="text-sm font-semibold tracking-widest text-accent">VCD</div>
      </header>

      {/* 데스크탑 사이드바 */}
      <aside className="hidden flex-col overflow-y-auto border-r border-line bg-bg-elev md:flex">
        <SidebarContent profile={profile} />
      </aside>

      {/* 모바일 drawer + 백드롭 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto border-r border-line bg-bg-elev transition-transform duration-200 ease-out md:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-hidden={!drawerOpen}
      >
        <SidebarContent profile={profile} onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto md:flex-none">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default Layout;

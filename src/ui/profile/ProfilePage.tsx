import { useRef, useState, type ReactNode } from 'react';

import { Link } from 'react-router-dom';

import { ROUTES } from '@/constants/routes';
import { refractionToZernike } from '@/features/vcd/psf';
import {
  STORAGE_KEY,
  makeEmptyProfile,
  parseStoredProfile,
} from '@/schemas/profile';
import { useProfileStore } from '@/store/profileStore';
import type { EyeRefraction, VCDProfile } from '@/types/profile';

import PSFThumbnail from './PSFThumbnail';

/* ─────────────────────────────────────────────────────────
   ProfilePage — 측정 결과 통합 페이지.
   원본: vcd-display/vcd-app/js/profile.js의 페이지 UI 부분.
   ───────────────────────────────────────────────────────── */

type BannerKind = 'ok' | 'err';
type Banner = { kind: BannerKind; msg: string } | null;

function ProfilePage() {
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const [banner, setBanner] = useState<Banner>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const flash = (msg: string, kind: BannerKind) => {
    setBanner({ msg, kind });
    window.setTimeout(() => setBanner(null), 3000);
  };

  const handleExport = () => {
    const json = JSON.stringify(profile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const idTail = (profile.user_id || 'profile').slice(-8);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vcd-profile-${idTail}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        // 임포트는 빈 프로파일에 머지 후 스키마 검증.
        const merged = { ...makeEmptyProfile(), ...raw };
        const parsed = parseStoredProfile(merged);
        setProfile(parsed);
        flash('가져오기 완료', 'ok');
      } catch (e) {
        flash('가져오기 실패: ' + (e instanceof Error ? e.message : String(e)), 'err');
      }
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-4">
        <h2 className="text-2xl font-semibold text-text">시력 프로파일</h2>
        <p className="text-text-dim">측정된 데이터와 도출된 광학 특성을 한 화면에서 확인합니다.</p>
      </header>

      {banner && (
        <div
          className={[
            'mb-4 rounded-md border px-3 py-2 text-sm',
            banner.kind === 'ok'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-err/40 bg-err/10 text-err',
          ].join(' ')}
        >
          {banner.msg}
        </div>
      )}

      <Section title="측정 현황">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <CalibrationCard p={profile} />
          <RefractionCard p={profile} />
          <ZernikeCard p={profile} />
          <TodoCard
            icon="🔤"
            title="시력 검사 (LogMAR)"
            done={!!profile.logmar}
            route={ROUTES.vision}
          />
          <TodoCard
            icon="🎯"
            title="대비 민감도 (CSF)"
            done={!!profile.csf_curve}
            route={ROUTES.csf}
          />
          <TodoCard
            icon="🎨"
            title="색각"
            done={!!profile.color_vision}
            route={ROUTES.color}
          />
          <TodoCard
            icon="🔲"
            title="Amsler 시야"
            done={!!(profile.amsler_map_od || profile.amsler_map_os)}
            route={ROUTES.amsler}
          />
        </div>
      </Section>

      {profile.refraction && (
        <Section title="PSF 미리보기">
          <p className="mb-3 text-sm text-text-dim">
            이게 당신 눈의 광학 특성입니다 — 점광원이 망막에 맺히는 모양.
          </p>
          <div className="flex flex-wrap gap-6">
            <PSFThumbnail rx={profile.refraction.od ?? null} label="오른쪽 눈 (OD)" />
            <PSFThumbnail rx={profile.refraction.os ?? null} label="왼쪽 눈 (OS)" />
          </div>
        </Section>
      )}

      <Section title="데이터 관리">
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport}>📤 JSON 내보내기</Button>
          <label className="cursor-pointer rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent">
            📥 JSON 가져오기
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-text-dim">
          프로파일은 브라우저 localStorage(<code>{STORAGE_KEY}</code>)에 저장됩니다. 다른 기기로
          옮기려면 내보내기를 사용하세요. 가져오기는 기존 데이터를 완전히 덮어씁니다.
          초기화는 사이드바 하단에서 가능합니다.
        </p>
      </Section>

      <Section>
        <Recommendation p={profile} />
      </Section>
    </div>
  );
}

export default ProfilePage;

// ── Section wrapper ────────────────────────────────────
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && (
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-text-dim">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

// ── Generic UI bits ────────────────────────────────────
function Button({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md border px-3 py-1.5 text-sm transition-colors',
        danger
          ? 'border-err/40 bg-err/5 text-err hover:bg-err/10'
          : 'border-line bg-bg-elev-2 text-text hover:border-accent',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Card({
  children,
  empty,
}: {
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-md border p-4',
        empty
          ? 'border-dashed border-line bg-bg-elev/60'
          : 'border-line bg-bg-elev',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function CardHead({ icon, title, badge }: { icon: string; title: string; badge?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span aria-hidden className="text-base">
        {icon}
      </span>
      <h4 className="text-sm font-semibold text-text">{title}</h4>
      {badge && <span className="ml-auto">{badge}</span>}
    </div>
  );
}

function KV({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">{children}</dl>;
}
function K({ children }: { children: ReactNode }) {
  return <dt className="text-text-dim">{children}</dt>;
}
function V({ children, mono = true }: { children: ReactNode; mono?: boolean }) {
  return <dd className={mono ? 'font-mono text-text' : 'text-text'}>{children}</dd>;
}

function CardFoot({ to, label }: { to: string; label: string }) {
  return (
    <div className="mt-3 flex justify-end">
      <Link
        to={to}
        className="rounded-md border border-line bg-bg-elev-2 px-2.5 py-1 text-xs text-text hover:border-accent"
      >
        {label}
      </Link>
    </div>
  );
}

function ConfBadge({ c }: { c: number }) {
  const pct = Math.round(c * 100);
  const cls =
    c >= 0.85
      ? 'border-ok/40 bg-ok/10 text-ok'
      : c >= 0.7
        ? 'border-warn/40 bg-warn/10 text-warn'
        : 'border-err/40 bg-err/10 text-err';
  const label = c >= 0.85 ? '신뢰' : c >= 0.7 ? '참고' : '재검사';
  return (
    <span className={['rounded-md border px-1.5 py-0.5 text-[11px] font-mono', cls].join(' ')}>
      {label} {pct}%
    </span>
  );
}

// ── Per-card renderers ────────────────────────────────
function CalibrationCard({ p }: { p: VCDProfile }) {
  const c = p.calibration;
  if (!c || !c.screen_ppi) {
    return (
      <Card empty>
        <CardHead icon="📐" title="캘리브레이션" />
        <p className="text-sm text-text-dim">화면 PPI와 시청 거리 측정</p>
        <CardFoot to={ROUTES.calibration} label="검사하러 가기 →" />
      </Card>
    );
  }
  const date = c.calibration_timestamp
    ? new Date(c.calibration_timestamp).toLocaleDateString()
    : '--';
  return (
    <Card>
      <CardHead icon="📐" title="캘리브레이션" />
      <KV>
        <K>화면 PPI</K>
        <V>{c.screen_ppi}</V>
        <K>화면 폭</K>
        <V>{c.screen_width_mm} mm</V>
        <K>시청 거리</K>
        <V>{c.viewing_distance_cm} cm</V>
        <K>측정</K>
        <V mono={false}>
          <span className="text-text-dim">{date}</span>
        </V>
      </KV>
      <CardFoot to={ROUTES.calibration} label="재측정" />
    </Card>
  );
}

function fmtEye(eye: EyeRefraction | null | undefined): ReactNode {
  if (!eye) return <span className="text-text-dim">--</span>;
  const sph = (eye.sph > 0 ? '+' : '') + Number(eye.sph).toFixed(2);
  const cyl = Number(eye.cyl).toFixed(2);
  const axis = eye.axis + '°';
  return (
    <span className="font-mono">
      {sph} / {cyl} × {axis}
    </span>
  );
}

function RefractionCard({ p }: { p: VCDProfile }) {
  const r = p.refraction;
  if (!r) {
    return (
      <Card empty>
        <CardHead icon="🔭" title="굴절 검사" />
        <p className="text-sm text-text-dim">SPH / CYL / AXIS 추정</p>
        <CardFoot to={ROUTES.refraction} label="검사하러 가기 →" />
      </Card>
    );
  }
  const conf = r.confidence ?? 0;
  return (
    <Card>
      <CardHead icon="🔭" title="굴절" badge={<ConfBadge c={conf} />} />
      <KV>
        <K>OD</K>
        <V mono={false}>{fmtEye(r.od)}</V>
        <K>OS</K>
        <V mono={false}>{fmtEye(r.os)}</V>
      </KV>
      {conf < 0.7 && (
        <p className="mt-2 text-xs text-warn">⚠️ 재검사를 권장합니다 (신뢰도 70% 미만).</p>
      )}
      <CardFoot to={ROUTES.refraction} label="재측정" />
    </Card>
  );
}

function ZernikeCard({ p }: { p: VCDProfile }) {
  const r = p.refraction;
  if (!r) {
    return (
      <Card empty>
        <CardHead icon="🌀" title="Zernike 계수" />
        <p className="text-sm text-text-dim">굴절 검사 후 자동 도출</p>
        <CardFoot to={ROUTES.refraction} label="굴절 검사로 →" />
      </Card>
    );
  }
  const fmt = (z: { c3: number; c4: number; c5: number }) =>
    `c₃=${z.c3.toFixed(3)} · c₄=${z.c4.toFixed(3)} · c₅=${z.c5.toFixed(3)}`;
  const zOd = refractionToZernike(r.od, 3.0);
  const zOs = r.os ? refractionToZernike(r.os, 3.0) : null;
  return (
    <Card>
      <CardHead icon="🌀" title="Zernike (OSA, μm)" />
      <KV>
        <K>OD</K>
        <V>{fmt(zOd)}</V>
        {zOs && (
          <>
            <K>OS</K>
            <V>{fmt(zOs)}</V>
          </>
        )}
      </KV>
      <p className="mt-2 text-xs text-text-dim">동공 3.0mm 기준 · Thibos 2002 OSA 표준</p>
    </Card>
  );
}

function TodoCard({
  icon,
  title,
  done,
  route,
}: {
  icon: string;
  title: string;
  done: boolean;
  route: string;
}) {
  if (done) {
    return (
      <Card>
        <CardHead icon={icon} title={title} />
        <p className="text-sm text-ok">완료 ✓</p>
        <CardFoot to={route} label="재측정" />
      </Card>
    );
  }
  return (
    <Card empty>
      <CardHead icon={icon} title={title} />
      <p className="text-sm text-text-dim">미완료</p>
      <CardFoot to={route} label="검사하러 가기 →" />
    </Card>
  );
}

// ── Recommendation ────────────────────────────────────
function Recommendation({ p }: { p: VCDProfile }) {
  const rec = pickRecommendation(p);
  return (
    <div className="rounded-md border border-accent/40 bg-linear-to-br from-accent/10 to-accent-2/5 p-5">
      <div className="mb-1 text-xs uppercase tracking-widest text-accent">
        다음 추천 {rec.stepLabel}
      </div>
      <h3 className="mb-1 text-lg font-semibold text-text">{rec.title}</h3>
      <p className="mb-3 text-sm text-text-dim">{rec.desc}</p>
      <Link
        to={rec.route}
        className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
      >
        {rec.cta} →
      </Link>
    </div>
  );
}

function pickRecommendation(p: VCDProfile) {
  if (!p.calibration?.screen_ppi) {
    return {
      stepLabel: '· 1단계',
      title: '캘리브레이션부터 시작하세요',
      desc: '화면 PPI와 시청 거리는 모든 검사의 기준입니다. 1분 이내에 완료됩니다.',
      route: ROUTES.calibration,
      cta: '캘리브레이션 시작',
    };
  }
  if (!p.refraction?.od) {
    return {
      stepLabel: '· 2단계',
      title: '굴절 검사를 진행하세요',
      desc: 'SPH / CYL / AXIS는 광학 보정의 핵심 데이터입니다. 두 눈 각 약 3분.',
      route: ROUTES.refraction,
      cta: '굴절 검사 시작',
    };
  }
  if (!p.logmar) {
    return {
      stepLabel: '· 3단계 (선택)',
      title: 'VCD 보정 효과를 체험해보세요',
      desc: '본인 굴절 데이터로 화면 보정 시뮬레이션을 직접 확인할 수 있습니다.',
      route: ROUTES.webglTest,
      cta: 'WebGL 테스트로 이동',
    };
  }
  if (!p.csf_curve) {
    return {
      stepLabel: '· 4단계 (선택)',
      title: '대비 민감도 검사로 정밀도를 높이세요',
      desc: 'CSF는 글자가 아닌 일반 이미지 보정에 사용되는 핵심 지표입니다.',
      route: ROUTES.csf,
      cta: 'CSF 검사 시작',
    };
  }
  return {
    stepLabel: '· 완료',
    title: '주요 측정 완료',
    desc: '카메라 보정 또는 VCD 미리보기를 체험해보세요.',
    route: ROUTES.camera,
    cta: '카메라 보정으로',
  };
}

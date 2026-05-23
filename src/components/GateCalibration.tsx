import { Link } from 'react-router-dom';

import { ROUTES } from '@/constants/routes';

/**
 * 캘리브레이션이 안 된 상태에서 다른 검사 페이지에 들어왔을 때 표시하는 안내.
 */
function GateCalibration({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-md border border-warn/40 bg-warn/5 p-5">
        <h3 className="mb-2 text-lg font-semibold text-warn">⚠️ 캘리브레이션이 먼저 필요합니다</h3>
        <p className="mb-3 text-sm text-text">{reason}</p>
        <p className="mb-4 text-sm text-text-dim">
          캘리브레이션 없이는 측정값을 신뢰할 수 없습니다.
        </p>
        <Link
          to={ROUTES.calibration}
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-2"
        >
          캘리브레이션으로 이동 →
        </Link>
      </div>
    </div>
  );
}

export default GateCalibration;

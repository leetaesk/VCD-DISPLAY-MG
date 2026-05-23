import { CSF_FREQUENCIES_CPD } from '@/constants/vision';
import { NORMATIVE_LOG_MEAN, NORMATIVE_LOG_STD } from '@/features/vcd/csf';

/* ─────────────────────────────────────────────────────────
   CSFChart — log-log CSF 곡선 + ±1σ 정상 범위.
   Chart.js 대신 ~120줄 SVG 직접 구현 (roadmap 결정).
   ───────────────────────────────────────────────────────── */

export interface CsfDataset {
  label: string;
  sensitivities: (number | null)[];
  color: string;
}

const PAD = { top: 16, right: 16, bottom: 36, left: 48 };
const XMIN_LOG = Math.log10(0.4);
const XMAX_LOG = Math.log10(20);
const YMIN_LOG = Math.log10(5);
const YMAX_LOG = Math.log10(500);

interface Props {
  datasets: CsfDataset[];
  width?: number;
  height?: number;
}

function CSFChart({ datasets, width = 560, height = 320 }: Props) {
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const xToPx = (cpd: number) =>
    PAD.left + ((Math.log10(cpd) - XMIN_LOG) / (XMAX_LOG - XMIN_LOG)) * innerW;
  const yToPx = (s: number) =>
    PAD.top + (1 - (Math.log10(s) - YMIN_LOG) / (YMAX_LOG - YMIN_LOG)) * innerH;

  const upper = CSF_FREQUENCIES_CPD.map((f) =>
    Math.pow(10, NORMATIVE_LOG_MEAN[f] + NORMATIVE_LOG_STD[f]),
  );
  const lower = CSF_FREQUENCIES_CPD.map((f) =>
    Math.pow(10, NORMATIVE_LOG_MEAN[f] - NORMATIVE_LOG_STD[f]),
  );
  const bandPoints =
    CSF_FREQUENCIES_CPD.map((f, i) => `${xToPx(f)},${yToPx(upper[i])}`).join(' ') +
    ' ' +
    CSF_FREQUENCIES_CPD.slice()
      .reverse()
      .map((f) => {
        const i = CSF_FREQUENCIES_CPD.indexOf(f);
        return `${xToPx(f)},${yToPx(lower[i])}`;
      })
      .join(' ');

  // x ticks
  const xTicks = [0.5, 1, 2, 4, 8, 16];
  const yTicks = [10, 30, 100, 300];

  return (
    <svg width={width} height={height} role="img" aria-label="CSF chart" className="overflow-visible">
      {/* normative ±1σ band */}
      <polygon points={bandPoints} fill="rgba(150,170,200,0.12)" stroke="rgba(150,170,200,0.30)" />

      {/* axes */}
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={PAD.top + innerH}
        stroke="rgba(255,255,255,0.2)"
      />
      <line
        x1={PAD.left}
        y1={PAD.top + innerH}
        x2={PAD.left + innerW}
        y2={PAD.top + innerH}
        stroke="rgba(255,255,255,0.2)"
      />

      {/* x ticks */}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line
            x1={xToPx(t)}
            y1={PAD.top + innerH}
            x2={xToPx(t)}
            y2={PAD.top + innerH + 4}
            stroke="#9aa3b2"
          />
          <text
            x={xToPx(t)}
            y={PAD.top + innerH + 18}
            fontSize={10}
            fill="#9aa3b2"
            textAnchor="middle"
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
          >
            {t}
          </text>
        </g>
      ))}
      <text
        x={PAD.left + innerW / 2}
        y={height - 4}
        fontSize={11}
        fill="#9aa3b2"
        textAnchor="middle"
      >
        공간 주파수 (cpd, log)
      </text>

      {/* y ticks */}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={PAD.left - 4}
            y1={yToPx(t)}
            x2={PAD.left}
            y2={yToPx(t)}
            stroke="#9aa3b2"
          />
          <line
            x1={PAD.left}
            y1={yToPx(t)}
            x2={PAD.left + innerW}
            y2={yToPx(t)}
            stroke="rgba(255,255,255,0.05)"
          />
          <text
            x={PAD.left - 6}
            y={yToPx(t) + 3}
            fontSize={10}
            fill="#9aa3b2"
            textAnchor="end"
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
          >
            {t}
          </text>
        </g>
      ))}
      <text
        x={12}
        y={PAD.top + innerH / 2}
        fontSize={11}
        fill="#9aa3b2"
        textAnchor="middle"
        transform={`rotate(-90 12 ${PAD.top + innerH / 2})`}
      >
        대비 민감도 (1/threshold, log)
      </text>

      {/* user datasets */}
      {datasets.map((ds) => (
        <g key={ds.label}>
          <polyline
            fill="none"
            stroke={ds.color}
            strokeWidth={2}
            points={CSF_FREQUENCIES_CPD.map((f, i) => {
              const s = ds.sensitivities[i];
              if (s === null || s === undefined) return null;
              return `${xToPx(f)},${yToPx(s)}`;
            })
              .filter((p): p is string => p !== null)
              .join(' ')}
          />
          {CSF_FREQUENCIES_CPD.map((f, i) => {
            const s = ds.sensitivities[i];
            if (s === null || s === undefined) return null;
            return (
              <circle
                key={`${ds.label}-${f}`}
                cx={xToPx(f)}
                cy={yToPx(s)}
                r={4}
                fill={ds.color}
                stroke="#0b0d12"
                strokeWidth={1.5}
              >
                <title>{`${ds.label} · ${f}cpd · ${s.toFixed(1)}`}</title>
              </circle>
            );
          })}
        </g>
      ))}

      {/* legend */}
      <g transform={`translate(${PAD.left + 8} ${PAD.top + 4})`}>
        {datasets.map((ds, i) => (
          <g key={ds.label} transform={`translate(0 ${i * 16})`}>
            <rect width={10} height={3} y={5} fill={ds.color} />
            <text x={16} y={9} fontSize={11} fill="#e7ecf3">
              {ds.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export default CSFChart;

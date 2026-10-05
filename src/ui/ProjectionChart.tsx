import { useId, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

// Single-series projection chart (I-20). One axis, thin 2px line, optional low–high band, recessive grid,
// crosshair + tooltip on hover/keyboard, a table view for accessibility. Colours come from --chart-* tokens.

export type ChartPoint = { x: number; y: number; low?: number; high?: number };
export type Marker = { x: number; label: string };

type Props = {
  title: string;
  points: ChartPoint[];
  xLabel: (x: number) => string;
  yLabel: (y: number) => string;
  yMin?: number;
  yMax?: number;
  markers?: Marker[];
  height?: number;
  tooltip?: (p: ChartPoint) => string;
  dashed?: boolean;
};

const W = 640;
const PAD = { l: 52, r: 16, t: 14, b: 30 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function ProjectionChart({ title, points, xLabel, yLabel, yMin, yMax, markers = [], height = 220, tooltip, dashed = false }: Props) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geo = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.flatMap((p) => [p.y, p.low ?? p.y, p.high ?? p.y]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = yMin ?? Math.min(0, ...ys);
    const y1 = yMax ?? (Math.max(...ys) * 1.08 || 1);
    const H = height;
    const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => H - PAD.b - ((y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
    const line = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    const hasBand = points.some((p) => p.low !== undefined);
    const band = hasBand
      ? `M${points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.high ?? p.y).toFixed(1)}`).join("L")}L${[...points]
          .reverse()
          .map((p) => `${sx(p.x).toFixed(1)},${sy(p.low ?? p.y).toFixed(1)}`)
          .join("L")}Z`
      : null;
    return { sx, sy, line, band, xTicks: niceTicks(x0, x1, 5), yTicks: niceTicks(y0, y1, 4), H, x0, x1 };
  }, [points, yMin, yMax, height]);

  if (points.length < 2) return null;
  const hp = hover !== null ? points[hover] : null;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(geo.sx(points[i]!.x) - x) < Math.abs(geo.sx(points[best]!.x) - x)) best = i;
    setHover(best);
  };

  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${geo.H}`}
          className="block w-full touch-none select-none outline-none"
          role="img"
          aria-label={title}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
            if (e.key === "Escape") setHover(null);
          }}
        >
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {geo.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--chart-grid)" />
              <text x={PAD.l - 8} y={geo.sy(t) + 4} textAnchor="end" className="fill-[var(--ink-3)] text-[11px]">
                {yLabel(t)}
              </text>
            </g>
          ))}
          {geo.xTicks.map((t) => (
            <text key={`x${t}`} x={geo.sx(t)} y={geo.H - 8} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">
              {xLabel(t)}
            </text>
          ))}
          {geo.band && <path d={geo.band} fill={`url(#fill-${id})`} />}
          {!geo.band && (
            <path d={`${geo.line}L${geo.sx(points.at(-1)!.x)},${geo.sy(geo.yTicks[0] ?? 0)}L${geo.sx(points[0]!.x)},${geo.sy(geo.yTicks[0] ?? 0)}Z`} fill={`url(#fill-${id})`} />
          )}
          <motion.path
            d={geo.line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashed ? "6 5" : undefined}
            // The draw-on animation uses the dash array itself, so dashed (what-if) lines fade in instead.
            initial={dashed ? { opacity: 0 } : { pathLength: 0 }}
            animate={dashed ? { opacity: 1 } : { pathLength: 1 }}
            transition={{ duration: dashed ? 0.4 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          />
          {markers.map((m) => (
            <g key={m.label}>
              <line x1={geo.sx(m.x)} x2={geo.sx(m.x)} y1={PAD.t} y2={geo.H - PAD.b} stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="3 4" />
              <text x={geo.sx(m.x) + 5} y={PAD.t + 11} className="fill-[var(--ink-2)] text-[11px] font-semibold">
                {m.label}
              </text>
            </g>
          ))}
          {hp && (
            <g pointerEvents="none">
              <line x1={geo.sx(hp.x)} x2={geo.sx(hp.x)} y1={PAD.t} y2={geo.H - PAD.b} stroke="var(--ink-3)" strokeWidth={1} />
              <circle cx={geo.sx(hp.x)} cy={geo.sy(hp.y)} r={5.5} fill="var(--chart-1)" stroke="var(--glass-strong)" strokeWidth={2.5} />
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="glass-strong pointer-events-none absolute top-1 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-lg"
            style={{ left: `${(geo.sx(hp.x) / W) * 100}%`, transform: `translateX(${geo.sx(hp.x) > W * 0.7 ? "-105%" : "8px"})` }}
          >
            {tooltip ? tooltip(hp) : `${xLabel(hp.x)} · ${yLabel(hp.y)}`}
          </div>
        )}
      </div>
      <figcaption className="flex justify-end">
        <button type="button" className="text-xs font-semibold text-sky hover:underline" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Hide table" : "Show as table"}
        </button>
      </figcaption>
      {showTable && (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-hairline">
            {points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 12)) === 0 || i === points.length - 1).map((p) => (
              <tr key={p.x}>
                <td className="py-1 text-ink-2">{xLabel(p.x)}</td>
                <td className="py-1 text-right font-semibold tabular-nums">{tooltip ? tooltip(p) : yLabel(p.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

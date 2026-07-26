"use client";

import { useState } from "react";
import { formatTime } from "@/lib/format";

export interface DayClockSegment {
  status: "occupied" | "vacant";
  from: string;
  to: string;
}

// Same hexes the desktop counter app uses for its table tiles (vacant/occupied
// tailwind tokens) — one status vocabulary across both apps, not a second palette.
const STATUS_COLOR: Record<DayClockSegment["status"], string> = {
  vacant: "#16a34a",
  occupied: "#dc2626",
};
const STATUS_LABEL: Record<DayClockSegment["status"], string> = {
  vacant: "Vacant",
  occupied: "Occupied",
};

const SIZE = 180;
const CENTER = SIZE / 2;
const OUTER_R = 82;
const INNER_R = 54;
const GAP_DEG = 1.2; // angular surface-gap between touching arcs

function polarToCartesian(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

function arcPath(startAngle: number, endAngle: number): string {
  const a0 = Math.min(startAngle, endAngle);
  const a1 = Math.max(startAngle, endAngle);
  const startOuter = polarToCartesian(a1, OUTER_R);
  const endOuter = polarToCartesian(a0, OUTER_R);
  const startInner = polarToCartesian(a0, INNER_R);
  const endInner = polarToCartesian(a1, INNER_R);
  const largeArc = a1 - a0 <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

const HOUR_TICKS = [0, 6, 12, 18];

/**
 * The "round graph" — one table's full day as a 24-hour ring, occupied vs
 * vacant, so a long list of time windows reads as one shape at a glance.
 * 12 o'clock = midnight, clockwise = later in the day.
 */
export function TableDayClock({
  dayStartIso,
  segments,
  label,
  utilizationPercent,
}: {
  dayStartIso: string;
  segments: DayClockSegment[];
  label: string;
  utilizationPercent: number;
}) {
  const [hovered, setHovered] = useState<{ segment: DayClockSegment; x: number; y: number } | null>(null);
  const dayStartMs = new Date(dayStartIso).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  function toAngle(iso: string): number {
    const fraction = Math.min(1, Math.max(0, (new Date(iso).getTime() - dayStartMs) / dayMs));
    return fraction * 360;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${label}: ${utilizationPercent}% occupied today`}
        >
          {segments.length === 0 ? (
            <circle cx={CENTER} cy={CENTER} r={(OUTER_R + INNER_R) / 2} fill="none" stroke="currentColor" strokeWidth={OUTER_R - INNER_R} className="text-slate-100 dark:text-slate-800" />
          ) : (
            segments.map((seg, i) => {
              const a0 = toAngle(seg.from);
              const a1 = toAngle(seg.to);
              if (a1 - a0 <= GAP_DEG * 1.5) return null; // too thin to render/hover meaningfully
              return (
                <path
                  key={i}
                  d={arcPath(a0 + GAP_DEG / 2, a1 - GAP_DEG / 2)}
                  fill={STATUS_COLOR[seg.status]}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseEnter={(e) => setHovered({ segment: seg, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHovered({ segment: seg, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })
          )}
          {HOUR_TICKS.map((h) => {
            const p = polarToCartesian((h / 24) * 360, OUTER_R + 10);
            return (
              <text
                key={h}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-400 text-[9px] dark:fill-slate-500"
              >
                {h.toString().padStart(2, "0")}
              </text>
            );
          })}
          <text x={CENTER} y={CENTER - 6} textAnchor="middle" className="fill-slate-900 text-lg font-semibold dark:fill-white">
            {utilizationPercent}%
          </text>
          <text x={CENTER} y={CENTER + 12} textAnchor="middle" className="fill-slate-400 text-[10px] dark:fill-slate-500">
            occupied
          </text>
        </svg>
        {hovered ? (
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
            style={{ left: hovered.x + 12, top: hovered.y + 12 }}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[hovered.segment.status] }} />
              {STATUS_LABEL[hovered.segment.status]}
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              {formatTime(hovered.segment.from)} → {formatTime(hovered.segment.to)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="text-center text-sm font-medium text-slate-700 dark:text-slate-200">{label}</div>
    </div>
  );
}

/** One legend, shared above a grid of clocks rather than repeated per-chart. */
export function DayClockLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
      {(Object.keys(STATUS_COLOR) as DayClockSegment["status"][]).map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

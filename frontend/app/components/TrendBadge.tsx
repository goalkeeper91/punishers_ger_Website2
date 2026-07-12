import type { Trend, ViewerStats } from "~/lib/socialStats";

export function TrendBadge({ trend }: { trend: Trend | null }) {
  if (!trend) return null;
  const isUp = trend.change > 0;
  const isFlat = trend.change === 0;
  const color = isFlat ? "text-gray-400" : isUp ? "text-green-400" : "text-red-400";
  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  const sign = trend.change > 0 ? "+" : "";
  return (
    <span className={`text-xs font-semibold ${color}`} title={`Letzte ${trend.days} Tage`}>
      {arrow} {sign}
      {trend.change.toLocaleString("de-DE")}
      {trend.percent != null ? ` (${sign}${trend.percent}%)` : ""}
    </span>
  );
}

export function ViewerStatsBadge({ viewerStats }: { viewerStats: ViewerStats | null }) {
  if (!viewerStats) return null;
  return (
    <span className="text-xs text-gray-400">
      Ø {viewerStats.avg_viewers.toLocaleString("de-DE")} · Peak {viewerStats.peak_viewers.toLocaleString("de-DE")} Zuschauer (
      {viewerStats.samples} Messungen)
    </span>
  );
}

export function DataSourceBadge({ source }: { source: "auto" | "manual" }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
        source === "auto" ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-300"
      }`}
    >
      {source === "auto" ? "Automatisch" : "Manuell"}
    </span>
  );
}

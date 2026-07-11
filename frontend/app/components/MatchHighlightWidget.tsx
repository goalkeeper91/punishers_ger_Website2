import { useEffect, useState } from "react";
import type { MatchHighlight } from "~/lib/publicContent";

// "Score bug" style widget: a compact floating card (not a full homepage
// section) so it stays eye-catching without eating up layout real estate.
// Common pattern in sports broadcast/streaming UIs, and a deliberate
// contrast to how big org sites (NAVI, G2, ...) dedicate a full section to
// match schedules - that doesn't fit a hobby-scale roster/homepage.
//
// Rotates through every team's next/last match (one of each per team with
// synced data) rather than picking a single team to feature - every squad,
// main roster or not, gets its turn.
const SESSION_DISMISS_KEY = "punishers_match_widget_dismissed";
const ROTATE_INTERVAL_MS = 6000;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  const timeStr = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} · ${timeStr} Uhr`;
}

function resultLabel(result: MatchHighlight["result"]): string {
  if (result === "win") return "Sieg";
  if (result === "loss") return "Niederlage";
  if (result === "draw") return "Unentschieden";
  return "";
}

function resultColor(result: MatchHighlight["result"]): string {
  if (result === "win") return "bg-green-600";
  if (result === "loss") return "bg-red-600";
  return "bg-gray-600";
}

function MatchContent({ match }: { match: MatchHighlight }) {
  return (
    <div key={match.faceit_match_id} className="motion-safe:animate-fade-in">
      <p className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-1.5">
        {match.kind === "next" ? "Nächstes Match" : "Letztes Ergebnis"}
      </p>
      <p className="text-white font-bold text-sm mb-1.5 leading-snug">
        {match.team_name} <span className="text-gray-500 font-normal">vs</span> {match.opponent_name ?? "TBD"}
      </p>
      {match.kind === "next" && match.scheduled_at && (
        <p className="text-gray-300 text-sm">{formatDateTime(match.scheduled_at)}</p>
      )}
      {match.kind === "last" && (
        <div className="flex items-center gap-2">
          {match.result && (
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded text-white ${resultColor(match.result)}`}>
              {resultLabel(match.result)}
            </span>
          )}
          {match.team_score !== null && match.opponent_score !== null && (
            <span className="text-gray-300 text-sm font-semibold">
              {match.team_score} : {match.opponent_score}
            </span>
          )}
        </div>
      )}
      {match.competition_name && <p className="text-gray-500 text-xs mt-1.5">{match.competition_name}</p>}
    </div>
  );
}

export default function MatchHighlightWidget({ highlights }: { highlights: MatchHighlight[] }) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") {
      setDismissed(true);
    }
  }, []);

  useEffect(() => {
    if (highlights.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % highlights.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [highlights.length]);

  if (highlights.length === 0 || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  };

  const current = highlights[index % highlights.length];

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-6 right-6 z-40 bg-red-600 hover:bg-red-700 text-white rounded-full h-14 w-14 shadow-xl flex items-center justify-center motion-safe:animate-slide-in-up"
        aria-label="Match-Info anzeigen"
      >
        <span className="relative flex h-3 w-3">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-72 max-w-[85vw] bg-gray-900 border border-red-600/40 rounded-xl shadow-2xl p-4 motion-safe:animate-slide-in-up">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-wrap gap-1.5 max-w-[70%]">
          {highlights.length > 1 &&
            highlights.map((h, i) => (
              <span
                key={h.faceit_match_id}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? "bg-red-500" : "bg-gray-700"}`}
              />
            ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-white leading-none" aria-label="Minimieren">
            &minus;
          </button>
          <button onClick={handleDismiss} className="text-gray-500 hover:text-white leading-none" aria-label="Schließen">
            &times;
          </button>
        </div>
      </div>
      <a href="/teams" className="block">
        <MatchContent match={current} />
      </a>
    </div>
  );
}

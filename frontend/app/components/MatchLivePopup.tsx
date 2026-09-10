import { useEffect, useState } from "react";
import { fetchLiveBroadcast, type LiveBroadcast } from "~/lib/publicContent";

// Site-wide "a match is live" popup. Mounted once in root.tsx so it can
// appear on every page (unlike MatchHighlightWidget, which is homepage-only).
// Same visual language as MatchHighlightWidget: a compact floating card
// bottom-right, collapsible to a pulsing dot, dismissible for the session.
//
// Purely client-driven - it renders nothing on the server and on the first
// client paint (state starts null), then polls the backend cache, so there
// is no SSR/hydration surface and no date formatting to get wrong (#418).
const SESSION_DISMISS_KEY = "punishers_live_popup_dismissed";
const POLL_INTERVAL_MS = 90_000;

export default function MatchLivePopup() {
  const [live, setLive] = useState<LiveBroadcast | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [parentHost, setParentHost] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setParentHost(window.location.hostname);
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* private mode / storage blocked - just show the popup */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await fetchLiveBroadcast();
      if (!cancelled) setLive(data);
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (dismissed || !live) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // Twitch's embedded player requires a `parent` matching the embedding
  // page's hostname - derived client-side so it always matches whatever
  // domain the site is served from.
  const canEmbed = Boolean(live.caster_login && parentHost);
  // Defense-in-depth: the backend already only stores http(s) caster URLs
  // (twitch_integration/client.normalize_caster), but never feed anything
  // else into an href here either.
  const safeStreamUrl = /^https?:\/\//i.test(live.caster_url) ? live.caster_url : null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-6 right-6 z-40 bg-red-600 hover:bg-red-700 text-white rounded-full h-14 w-14 shadow-xl flex items-center justify-center motion-safe:animate-slide-in-up"
        aria-label="Live-Match anzeigen"
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
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-500">
          <span className="relative flex h-2 w-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          Live
        </span>
        <div className="flex gap-3">
          <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-white leading-none" aria-label="Minimieren">
            &minus;
          </button>
          <button onClick={handleDismiss} className="text-gray-500 hover:text-white leading-none" aria-label="Schließen">
            &times;
          </button>
        </div>
      </div>

      <p className="text-white font-bold text-sm mb-1 leading-snug">
        {live.team_name} <span className="text-gray-500 font-normal">vs</span> {live.opponent_name ?? "TBD"}
      </p>
      {live.stream_title && <p className="text-gray-400 text-xs mb-1 line-clamp-2">{live.stream_title}</p>}
      <p className="text-gray-500 text-xs mb-3">
        {live.caster_login ? `twitch.tv/${live.caster_login}` : "Externer Stream"}
        {typeof live.viewer_count === "number" && ` · ${live.viewer_count.toLocaleString("de-DE")} Zuschauer`}
      </p>

      {showPlayer && canEmbed && (
        <div className="mb-3 aspect-video w-full overflow-hidden rounded-md bg-black">
          <iframe
            src={`https://player.twitch.tv/?channel=${encodeURIComponent(live.caster_login)}&parent=${parentHost}&muted=true`}
            title="Twitch Stream"
            className="h-full w-full"
            allowFullScreen
          />
        </div>
      )}

      <div className="flex gap-2">
        {canEmbed && (
          <button
            onClick={() => setShowPlayer((v) => !v)}
            className="flex-1 py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-700 hover:bg-gray-600"
          >
            {showPlayer ? "Player ausblenden" : "Hier ansehen"}
          </button>
        )}
        {safeStreamUrl && (
          <a
            href={safeStreamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700"
          >
            Zum Stream
          </a>
        )}
      </div>
    </div>
  );
}

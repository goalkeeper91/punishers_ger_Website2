import { useRef, useState } from "react";
import { Form } from "react-router";
import { analyzeScreenshot, type SocialChannel } from "~/lib/socialStats";
import { TrendBadge, ViewerStatsBadge, DataSourceBadge } from "~/components/TrendBadge";

const METRIC_FIELDS: { key: keyof SocialChannel; label: string }[] = [
  { key: "follower_count", label: "Follower" },
  { key: "view_count", label: "Views" },
  { key: "like_count", label: "Likes" },
  { key: "comment_count", label: "Kommentare" },
  { key: "share_count", label: "Shares" },
  { key: "reach_count", label: "Reichweite" },
  { key: "impressions_count", label: "Impressionen" },
];

interface SocialMetricsCardProps {
  title: string;
  channel: SocialChannel;
  /** Extra hidden fields identifying which row this form updates (e.g. linkId, or userId+platform). */
  hiddenFields: Record<string, string | number>;
  intentFieldName: string; // "_intent" (admin page) or "_formType" (profile page)
  intentValue: string;
  uploadKey: string;
  isSubmitting: boolean;
  /** e.g. the Twitch connect/disconnect button, rendered next to the badges. */
  headerExtra?: React.ReactNode;
}

/** One channel's full metrics form: follower/view/like/comment/share/reach/
 * impressions inputs in a clean grid, a screenshot-upload button that can
 * fill several of them at once, and a single Speichern button - shared by
 * the admin social-stats page (org channels + per-player breakdown) and
 * the profile page's self-service "Meine Reichweite" section so both stay
 * visually consistent instead of each hand-rolling a cramped inline form. */
export function SocialMetricsCard({
  title,
  channel,
  hiddenFields,
  intentFieldName,
  intentValue,
  uploadKey,
  isSubmitting,
  headerExtra,
}: SocialMetricsCardProps) {
  const inputRefs = useRef<Partial<Record<keyof SocialChannel, HTMLInputElement | null>>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeScreenshot(file);
      let filledCount = 0;
      for (const [metric, value] of Object.entries(result.metrics)) {
        const input = inputRefs.current[metric as keyof SocialChannel];
        if (input) {
          input.value = String(value);
          filledCount += 1;
        }
      }
      if (filledCount === 0) {
        setError(`Konnte keine Zahlen sicher erkennen. Erkannter Text: "${result.raw_text.slice(0, 150)}" - bitte manuell eingeben.`);
      }
    } catch (err: any) {
      setError(err.message || "Screenshot-Auswertung fehlgeschlagen.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white font-semibold">{title}</span>
          <DataSourceBadge source={channel.data_source} />
          <TrendBadge trend={channel.trend} />
        </div>
        {headerExtra}
      </div>

      {channel.viewer_stats && (
        <div className="mb-3">
          <ViewerStatsBadge viewerStats={channel.viewer_stats} />
        </div>
      )}

      {error && <div className="bg-red-800 text-white text-xs p-2 rounded-md mb-3">{error}</div>}

      <Form method="post" className="space-y-3">
        <input type="hidden" name={intentFieldName} value={intentValue} />
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {METRIC_FIELDS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="block text-xs text-gray-400 mb-1">{label}</span>
              <input
                ref={(el) => {
                  inputRefs.current[key] = el;
                }}
                type="number"
                name={key}
                min={0}
                defaultValue={(channel[key] as number | null) ?? ""}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              id={`screenshot-${uploadKey}`}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleUpload(file);
                event.target.value = "";
              }}
            />
            <label
              htmlFor={`screenshot-${uploadKey}`}
              className="cursor-pointer py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-700 hover:bg-gray-600"
            >
              {analyzing ? "Wird ausgewertet..." : "📷 Screenshot"}
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="py-1.5 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
          {channel.stats_updated_at && (
            <span className="text-xs text-gray-500">{new Date(channel.stats_updated_at).toLocaleString("de-DE")}</span>
          )}
        </div>
      </Form>
    </div>
  );
}

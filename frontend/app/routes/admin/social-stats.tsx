import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, redirect } from "react-router";
import { useState } from "react";
import { isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import {
  fetchSocialStatsOverview,
  updateOrgSocialStats,
  updatePlayerSocialStats,
  triggerSocialStatsSync,
  fetchTwitchAuthorizeUrl,
  disconnectTwitchOrg,
  type SocialStatsOverview,
  type SocialMetricsPayload,
} from "~/lib/socialStats";
import AdminNav from "~/components/AdminNav";
import { SocialMetricsCard } from "~/components/SocialMetricsCard";

const PLATFORM_LABELS: Record<string, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  twitter: "Twitter/X",
  instagram: "Instagram",
  tiktok: "TikTok",
  discord: "Discord",
  other: "Sonstiges",
};

const METRIC_FIELD_NAMES: (keyof SocialMetricsPayload)[] = [
  "follower_count",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
  "reach_count",
  "impressions_count",
];

function readMetricsPayload(formData: FormData): SocialMetricsPayload {
  const payload: SocialMetricsPayload = {};
  for (const field of METRIC_FIELD_NAMES) {
    const raw = formData.get(field);
    if (raw === null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) payload[field] = n;
  }
  return payload;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  try {
    const overview = await fetchSocialStatsOverview();
    return { overview };
  } catch (error: any) {
    if (error.message?.includes("401")) throw redirect("/login");
    if (error.message?.includes("403")) throw redirect("/admin"); // logged in, just lacks sponsors.manage_sponsors
    throw error;
  }
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    switch (intent) {
      case "updateOrgStats": {
        const linkId = Number(formData.get("linkId"));
        await updateOrgSocialStats(linkId, readMetricsPayload(formData));
        return { success: "Org-Kanal aktualisiert." };
      }
      case "updatePlayerStats": {
        const userId = Number(formData.get("userId"));
        const platform = String(formData.get("platform"));
        await updatePlayerSocialStats(userId, platform, readMetricsPayload(formData));
        return { success: "Spieler-Statistik aktualisiert." };
      }
      case "sync": {
        const summary = await triggerSocialStatsSync();
        return {
          success: `Sync abgeschlossen: ${summary.org_channels_synced} Org-Kanäle, ${summary.player_channels_synced} Spieler-Kanäle synchronisiert.`,
        };
      }
      case "disconnectTwitchOrg": {
        const linkId = Number(formData.get("linkId"));
        await disconnectTwitchOrg(linkId);
        return { success: "Twitch-Verbindung getrennt." };
      }
      default:
        return { error: "Unbekannte Aktion." };
    }
  } catch (error: any) {
    return { error: extractErrorMessage(error, error.message || "Ein Fehler ist aufgetreten.") };
  }
};

function formatCount(value: number | null): string {
  return value != null ? value.toLocaleString("de-DE") : "–";
}

export default function AdminSocialStatsPage() {
  const { overview } = useLoaderData() as { overview: SocialStatsOverview };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const [connectingLinkId, setConnectingLinkId] = useState<number | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnectTwitch = async (linkId: number) => {
    setConnectingLinkId(linkId);
    setConnectError(null);
    try {
      const url = await fetchTwitchAuthorizeUrl("org", linkId);
      window.location.href = url;
    } catch (err: any) {
      setConnectError(err.message || "Twitch-Verbindung konnte nicht gestartet werden.");
      setConnectingLinkId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-10">Admin Dashboard</h1>
        <AdminNav active="social-stats" />

        <div className="max-w-6xl mx-auto space-y-10 mt-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-800 rounded-lg shadow-xl p-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Social-Media-Reichweite</h2>
              <p className="text-gray-400 text-sm">
                Für Sponsoren-Reportings: Reichweite und Engagement der Org-Kanäle, Spieler und Teams. YouTube
                (Abos/Views) und Discord (Mitgliederzahl) werden automatisch synchronisiert. Twitch kann pro Kanal
                verbunden werden und synchronisiert dann ebenfalls automatisch; Views/Likes/Kommentare/Shares/Reichweite/
                Impressionen müssen überall manuell gepflegt oder per Screenshot ausgelesen werden, da keine dieser
                Plattformen dafür eine öffentliche API anbietet.
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="_intent" value="sync" />
              <button
                type="submit"
                disabled={isSubmitting}
                className="whitespace-nowrap inline-flex justify-center py-2 px-6 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                Jetzt synchronisieren
              </button>
            </Form>
          </div>

          {actionData?.error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 rounded-md p-4">{actionData.error}</div>
          )}
          {actionData?.success && (
            <div className="bg-green-900/50 border border-green-700 text-green-200 rounded-md p-4">{actionData.success}</div>
          )}
          {searchParams.get("twitch_connected") && (
            <div className="bg-green-900/50 border border-green-700 text-green-200 rounded-md p-4">
              Twitch-Kanal erfolgreich verbunden.
            </div>
          )}
          {searchParams.get("twitch_error") && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 rounded-md p-4">
              Twitch-Verbindung fehlgeschlagen. Bitte erneut versuchen.
            </div>
          )}
          {connectError && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 rounded-md p-4">{connectError}</div>
          )}

          {/* Org channels */}
          <section className="bg-gray-800 rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold text-white mb-2">Org-Kanäle</h2>
            <p className="text-gray-400 text-sm mb-6">
              Gesamt-Reichweite: <span className="text-white font-semibold">{formatCount(overview.org_total_followers)}</span>
            </p>
            {overview.org_channels.length === 0 ? (
              <p className="text-gray-500 text-sm">Noch keine Social Links hinterlegt.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {overview.org_channels.map((channel) => (
                  <SocialMetricsCard
                    key={channel.id}
                    title={PLATFORM_LABELS[channel.platform] || channel.platform}
                    channel={channel}
                    hiddenFields={{ linkId: channel.id }}
                    intentFieldName="_intent"
                    intentValue="updateOrgStats"
                    uploadKey={`org-${channel.id}`}
                    isSubmitting={isSubmitting}
                    headerExtra={
                      channel.platform === "twitch" ? (
                        channel.twitch_connected ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-green-400">Verbunden als {channel.twitch_authorized_login}</span>
                            <Form method="post">
                              <input type="hidden" name="_intent" value="disconnectTwitchOrg" />
                              <input type="hidden" name="linkId" value={channel.id} />
                              <button
                                type="submit"
                                disabled={isSubmitting}
                                className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-50"
                              >
                                Trennen
                              </button>
                            </Form>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConnectTwitch(channel.id)}
                            disabled={connectingLinkId === channel.id}
                            className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
                          >
                            {connectingLinkId === channel.id ? "Weiterleitung..." : "Twitch verbinden"}
                          </button>
                        )
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Team reach (aggregated from roster players) */}
          <section className="bg-gray-800 rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold text-white mb-2">Team-Reichweite</h2>
            <p className="text-gray-400 text-sm mb-6">Summe der Social-Media-Reichweite aller Spieler im Roster.</p>
            {overview.teams.length === 0 ? (
              <p className="text-gray-500 text-sm">Noch keine Teams vorhanden.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
                      <th className="py-2 pr-4">Team</th>
                      <th className="py-2 pr-4">Spieler</th>
                      <th className="py-2 pr-4">Gesamt-Reichweite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.teams.map((team) => (
                      <tr key={team.team_id} className="border-b border-gray-800 text-gray-300">
                        <td className="py-2 pr-4 font-semibold text-white">{team.team_name}</td>
                        <td className="py-2 pr-4">{team.player_count}</td>
                        <td className="py-2 pr-4 text-white font-semibold">{formatCount(team.total_followers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Player reach breakdown */}
          <section className="bg-gray-800 rounded-lg shadow-xl p-6">
            <h2 className="text-2xl font-bold text-white mb-2">Spieler-Reichweite</h2>
            <p className="text-gray-400 text-sm mb-6">
              Nur Spieler mit mindestens einem verknüpften oder manuell gepflegten Kanal werden aufgelistet.
            </p>
            {overview.players.length === 0 ? (
              <p className="text-gray-500 text-sm">Keine Spieler mit Social-Media-Kanälen gefunden.</p>
            ) : (
              <div className="space-y-6">
                {overview.players.map((player) => (
                  <div key={player.user_id} className="bg-gray-950 rounded-lg p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                      <div>
                        <span className="text-white font-semibold">{player.ingame_name}</span>
                        {player.team_name && <span className="text-gray-500 text-sm ml-2">({player.team_name})</span>}
                      </div>
                      <span className="text-white font-semibold">{formatCount(player.total_followers)} gesamt</span>
                    </div>
                    {player.channels.length === 0 ? (
                      <p className="text-gray-500 text-sm">Keine Kanäle verknüpft.</p>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {player.channels.map((channel) => (
                          <SocialMetricsCard
                            key={channel.platform}
                            title={PLATFORM_LABELS[channel.platform] || channel.platform}
                            channel={channel}
                            hiddenFields={{ userId: player.user_id, platform: channel.platform }}
                            intentFieldName="_intent"
                            intentValue="updatePlayerStats"
                            uploadKey={`player-${player.user_id}-${channel.platform}`}
                            isSubmitting={isSubmitting}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

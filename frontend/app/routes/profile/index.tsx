import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch, isLoggedIn, clearTokens, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { getAdminNavItems } from "~/lib/adminNav";
import { imageFallback } from "~/lib/sampleAssets";
import { TrendBadge, ViewerStatsBadge } from "~/components/TrendBadge";
import { SocialMetricsCard } from "~/components/SocialMetricsCard";
import { translate, getLanguageFromCookieHeader } from "~/i18n/config";
import {
  fetchTwitchAuthorizeUrl,
  disconnectTwitchPlayer,
  fetchMySocialChannels,
  updateMySocialStats,
  type SocialChannel,
  type SocialMetricsPayload,
} from "~/lib/socialStats";

const MANUAL_METRIC_FIELDS: (keyof SocialMetricsPayload)[] = [
  "follower_count",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
  "reach_count",
  "impressions_count",
];

const MANUAL_PLATFORMS: { key: string; label: string }[] = [
  { key: "twitter", label: "Twitter/X" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
];

type UserProfile = AuthUser;

// --- CLIENT LOADER FUNCTION ---
// Runs in the browser (not on the server), since the session lives in
// localStorage (see app/lib/auth.ts), which the server can't read.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const userResponse = await authFetch("/users/me/");

    if (!userResponse.ok) {
      if (userResponse.status === 401 || userResponse.status === 403) {
        clearTokens();
        throw redirect("/login");
      }
      const errorText = await userResponse.text();
      throw new Error(`HTTP error! status: ${userResponse.status}, detail: ${errorText}`);
    }
    const user: UserProfile = await userResponse.json();
    const socialChannels = await fetchMySocialChannels().catch(() => [] as SocialChannel[]);
    return { user, socialChannels };
  } catch (error) {
    if (error instanceof Response) {
      throw error; // Re-throw redirect responses
    }
    console.error("Loader: Failed to fetch user profile:", error);
    return { user: null, error: "Failed to load user profile.", socialChannels: [] as SocialChannel[] };
  }
};

export function HydrateFallback() {
  const { t } = useTranslation("profile");
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">{t("loading")}</p>
    </div>
  );
}

// --- CLIENT ACTION FUNCTION ---
// Runs outside React render, so error/success messages use the static
// translate() helper (see ~/i18n/config) with the language read directly
// from document.cookie, not the useTranslation() hook.
export const clientAction: ClientActionFunction = async ({ request }) => {
  const language = getLanguageFromCookieHeader(document.cookie);
  const t = (key: string) => translate(language, key, "profile");

  const formData = await request.formData();
  const formType = formData.get("_formType"); // To distinguish between profile update and image upload

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (formType === "profileUpdate") {
      const updateData: { [key: string]: any } = {};
      const fields = ["first_name", "last_name", "steam_id", "game_profile_link", "twitter_link", "twitch_link", "youtube_link", "instagram_link", "tiktok_link"];
      fields.forEach(field => {
        const value = formData.get(field);
        if (value !== null && value !== "") { // Only send fields that are present and not empty
          updateData[field] = value;
        } else if (value === "") { // Allow clearing fields by sending empty string
          updateData[field] = null;
        }
      });

      const response = await authFetch(`/users/me/`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: t("action_messages.profile_updated") };

    } else if (formType === "profilePictureUpload") {
      const file = formData.get("profile_picture");
      if (!file || !(file instanceof File)) {
        return { error: t("action_messages.no_file_selected") };
      }

      const imageFormData = new FormData();
      imageFormData.append("file", file);

      const response = await authFetch(`/users/me/profile_picture/`, {
        method: "POST",
        body: imageFormData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: t("action_messages.picture_uploaded") };
    } else if (formType === "disconnectTwitch") {
      await disconnectTwitchPlayer();
      return { success: t("action_messages.twitch_disconnected") };
    } else if (formType === "updateMySocialStats") {
      const platform = String(formData.get("platform"));
      const payload: SocialMetricsPayload = {};
      for (const field of MANUAL_METRIC_FIELDS) {
        const raw = formData.get(field);
        if (raw === null || raw === "") continue;
        const n = Number(raw);
        if (Number.isFinite(n)) payload[field] = n;
      }
      await updateMySocialStats(platform, payload);
      return { success: t("action_messages.stats_updated") };
    }

    return { error: t("action_messages.unknown_form_type") };
  } catch (error: any) {
    console.error("Action failed:", error);
    return { error: error.message || t("action_messages.generic_error") };
  }
};


export default function ProfilePage() {
  const loaderData = useLoaderData() as { user: UserProfile | null; error?: string; socialChannels: SocialChannel[] };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const { t } = useTranslation("profile");

  const { user, error: loaderError, socialChannels } = loaderData;
  const twitchChannel = socialChannels.find((c) => c.platform === "twitch") ?? null;
  const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(user?.profile_picture_url || null);
  const [searchParams] = useSearchParams();
  const [twitchConnecting, setTwitchConnecting] = useState(false);
  const [twitchConnectError, setTwitchConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.profile_picture_url) {
      setProfilePicturePreview(user.profile_picture_url);
    }
  }, [user?.profile_picture_url]);

  const handleConnectTwitch = async () => {
    setTwitchConnecting(true);
    setTwitchConnectError(null);
    try {
      const url = await fetchTwitchAuthorizeUrl("player");
      window.location.href = url;
    } catch (err: any) {
      setTwitchConnectError(err.message || t("action_messages.twitch_connect_failed"));
      setTwitchConnecting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
        <h1 className="text-4xl font-bold text-white">{t("not_found")}</h1>
        {loaderError && <p className="text-red-500 mt-4">{loaderError}</p>}
      </div>
    );
  }

  const handleProfilePictureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setProfilePicturePreview(URL.createObjectURL(file));
    }
  };

  // /stats itself enforces who sees what (Admin: alle Teams/Spieler,
  // Teammanager: eigenes Team + Roster, sonst nur eigene Werte + Team-Maps)
  // - hier nur ein zur Rolle passendes Label, damit die Erwartung schon vor
  // dem Klick stimmt.
  const statsLabel = user.is_superuser
    ? t("sidebar.stats_admin")
    : hasRole(user, ROLE_TEAM_MANAGER)
    ? t("sidebar.stats_team_manager")
    : t("sidebar.stats_player");

  // Gleiche Rollen-Logik wie AdminNav (~/lib/adminNav.ts) - ein Spieler ohne
  // Rolle sieht hier folglich gar keine Verwaltungslinks.
  const adminNavItems = getAdminNavItems(user);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-gray-800 p-6 shadow-lg flex-shrink-0">
        <h2 className="text-2xl font-bold text-white mb-6">{t("sidebar.heading")}</h2>
        <nav>
          <ul>
            <li className="mb-4">
              <a href="/profile" className="block text-red-500 hover:text-red-400 font-semibold text-lg transition-colors duration-200">
                {t("sidebar.edit_profile")}
              </a>
            </li>
            <li className="mb-4">
              <a href="/stats" className="block text-gray-300 hover:text-white transition-colors duration-200">
                {statsLabel}
              </a>
            </li>
            {/* Add more profile-specific routes here */}
          </ul>

          {adminNavItems.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-8 mb-3">{t("sidebar.management")}</h3>
              <ul>
                {adminNavItems.map((item) => (
                  <li key={item.key} className="mb-4">
                    <a href={item.href} className="block text-gray-300 hover:text-white transition-colors duration-200">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-grow p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-8">{t("welcome", { username: user.username })}</h1>

          {actionData?.error && (
            <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">
              {actionData.error}
            </div>
          )}
          {actionData?.success && (
            <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">
              {actionData.success}
            </div>
          )}
          {searchParams.get("twitch_connected") && (
            <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">
              {t("messages.twitch_connected")}
            </div>
          )}
          {searchParams.get("twitch_error") && (
            <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">
              {t("messages.twitch_error")}
            </div>
          )}

          {/* Profile Picture Section */}
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
            <h2 className="text-3xl font-bold text-white mb-6">{t("picture.heading")}</h2>
            <div className="flex flex-col items-center md:flex-row md:items-start gap-8">
              <div className="flex-shrink-0">
                <img
                  className="h-32 w-32 rounded-full object-cover border-4 border-red-600"
                  src={profilePicturePreview || imageFallback("https://via.placeholder.com/150?text=User")}
                  alt={`${user.username}'s profile`}
                />
              </div>
              <div className="flex-grow">
                <Form method="post" encType="multipart/form-data" className="space-y-4">
                  <input type="hidden" name="_formType" value="profilePictureUpload" />
                  <div>
                    <label htmlFor="profile_picture" className="block text-sm font-medium text-gray-300 mb-2">{t("picture.upload_label")}</label>
                    <input
                      id="profile_picture"
                      name="profile_picture"
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureChange}
                      className="block w-full text-sm text-gray-300
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-full file:border-0
                        file:text-sm file:font-semibold
                        file:bg-red-600 file:text-white
                        hover:file:bg-red-700"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? t("picture.uploading") : t("picture.save")}
                  </button>
                </Form>
              </div>
            </div>
          </div>

          {/* Profile Details Section */}
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
            <h2 className="text-3xl font-bold text-white mb-6">{t("details.heading")}</h2>
            <Form method="post" className="space-y-6">
              <input type="hidden" name="_formType" value="profileUpdate" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-300">{t("details.username_label")}</label>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    defaultValue={user.username}
                    disabled // Username usually not editable directly
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-300">{t("details.email_label")}</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    defaultValue={user.email}
                    disabled // Email usually not editable directly or requires verification
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label htmlFor="first_name" className="block text-sm font-medium text-gray-300">{t("details.first_name_label")}</label>
                  <input
                    type="text"
                    id="first_name"
                    name="first_name"
                    defaultValue={user.first_name || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="last_name" className="block text-sm font-medium text-gray-300">{t("details.last_name_label")}</label>
                  <input
                    type="text"
                    id="last_name"
                    name="last_name"
                    defaultValue={user.last_name || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="steam_id" className="block text-sm font-medium text-gray-300">{t("details.steam_id_label")}</label>
                  <input
                    type="text"
                    id="steam_id"
                    name="steam_id"
                    defaultValue={user.steam_id || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="game_profile_link" className="block text-sm font-medium text-gray-300">{t("details.game_profile_link_label")}</label>
                  <input
                    type="url"
                    id="game_profile_link"
                    name="game_profile_link"
                    defaultValue={user.game_profile_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="twitter_link" className="block text-sm font-medium text-gray-300">{t("details.twitter_link_label")}</label>
                  <input
                    type="url"
                    id="twitter_link"
                    name="twitter_link"
                    defaultValue={user.twitter_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="twitch_link" className="block text-sm font-medium text-gray-300">{t("details.twitch_link_label")}</label>
                  <input
                    type="url"
                    id="twitch_link"
                    name="twitch_link"
                    defaultValue={user.twitch_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="youtube_link" className="block text-sm font-medium text-gray-300">{t("details.youtube_link_label")}</label>
                  <input
                    type="url"
                    id="youtube_link"
                    name="youtube_link"
                    defaultValue={user.youtube_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="instagram_link" className="block text-sm font-medium text-gray-300">{t("details.instagram_link_label")}</label>
                  <input
                    type="url"
                    id="instagram_link"
                    name="instagram_link"
                    defaultValue={user.instagram_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="tiktok_link" className="block text-sm font-medium text-gray-300">{t("details.tiktok_link_label")}</label>
                  <input
                    type="url"
                    id="tiktok_link"
                    name="tiktok_link"
                    defaultValue={user.tiktok_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("details.saving") : t("details.save")}
              </button>
            </Form>
          </div>

          {/* Twitch-Verbindung für automatisierte Follower-Synchronisation */}
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl mt-8">
            <h2 className="text-3xl font-bold text-white mb-2">{t("social.heading")}</h2>
            <p className="text-gray-400 text-sm mb-6">
              {t("social.description")}
            </p>
            {twitchConnectError && (
              <div className="bg-red-800 text-white p-3 rounded-md mb-4 text-sm">{twitchConnectError}</div>
            )}
            <div className="flex items-center justify-between bg-gray-900 rounded-md px-4 py-3">
              <div>
                <span className="text-white font-semibold">Twitch</span>
                {user.twitch_connected ? (
                  <span className="text-green-400 text-sm ml-2">{t("social.connected_as", { login: user.twitch_authorized_login })}</span>
                ) : (
                  <span className="text-gray-500 text-sm ml-2">{t("social.not_connected")}</span>
                )}
                {twitchChannel && (
                  <span className="ml-2">
                    <TrendBadge trend={twitchChannel.trend} />
                  </span>
                )}
                {twitchChannel?.viewer_stats && (
                  <div className="mt-1">
                    <ViewerStatsBadge viewerStats={twitchChannel.viewer_stats} />
                  </div>
                )}
              </div>
              {user.twitch_connected ? (
                <Form method="post">
                  <input type="hidden" name="_formType" value="disconnectTwitch" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-50"
                  >
                    {t("social.disconnect")}
                  </button>
                </Form>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectTwitch}
                  disabled={twitchConnecting}
                  className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  {twitchConnecting ? t("social.redirecting") : t("social.connect")}
                </button>
              )}
            </div>
          </div>

          {/* Manuelle Reichweite (Twitter/Instagram/TikTok) - Zahlen selbst
              eintragen oder per Screenshot auslesen lassen, statt einen
              Admin zu bitten. */}
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl mt-8">
            <h2 className="text-3xl font-bold text-white mb-2">{t("reach.heading")}</h2>
            <p className="text-gray-400 text-sm mb-6">
              {t("reach.description")}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {MANUAL_PLATFORMS.map(({ key, label }) => {
                const channel = socialChannels.find((c) => c.platform === key) ?? {
                  platform: key,
                  follower_count: null,
                  view_count: null,
                  like_count: null,
                  comment_count: null,
                  share_count: null,
                  reach_count: null,
                  impressions_count: null,
                  data_source: "manual" as const,
                  stats_updated_at: null,
                  trend: null,
                  viewer_stats: null,
                };
                return (
                  <SocialMetricsCard
                    key={key}
                    title={label}
                    channel={channel}
                    hiddenFields={{ platform: key }}
                    intentFieldName="_formType"
                    intentValue="updateMySocialStats"
                    uploadKey={key}
                    isSubmitting={isSubmitting}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

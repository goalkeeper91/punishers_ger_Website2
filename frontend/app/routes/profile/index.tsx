import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch, isLoggedIn, clearTokens, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { getAdminNavItems } from "~/lib/adminNav";
import { imageFallback } from "~/lib/sampleAssets";
import ImageCropInput from "~/components/ImageCropInput";
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

// Self-service Player profile (ingame_name + faceit_player_id) - separate
// from AuthUser/CustomUser since it lives on teams.Player, independent of
// team membership. null means the user hasn't created one yet (GET
// /players/me/ returns null rather than 404 in that case).
interface PlayerProfile {
  id: number;
  ingame_name: string;
  faceit_player_id: string | null;
  description: string | null;
  show_extended_profile: boolean;
}

// Result of GET /players/faceit-lookup/?nickname=... - resolves a FACEIT
// nickname (easy to find) to the numeric player_id (not) that actually
// gets stored/synced. See the "faceitLookup" clientAction branch below.
interface FaceitLookupResult {
  player_id: string;
  nickname: string;
  avatar: string | null;
  skill_level: number | null;
  faceit_elo: number | null;
}

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
    const player: PlayerProfile | null = await authFetch("/players/me/")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return { user, socialChannels, player };
  } catch (error) {
    if (error instanceof Response) {
      throw error; // Re-throw redirect responses
    }
    console.error("Loader: Failed to fetch user profile:", error);
    return { user: null, error: "Failed to load user profile.", socialChannels: [] as SocialChannel[], player: null };
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
      const fields = ["first_name", "last_name", "steam_id", "game_profile_link", "twitter_link", "twitch_link", "youtube_link", "instagram_link", "tiktok_link", "creator_bio"];
      fields.forEach(field => {
        const value = formData.get(field);
        if (value !== null && value !== "") { // Only send fields that are present and not empty
          updateData[field] = value;
        } else if (value === "") { // Allow clearing fields by sending empty string
          updateData[field] = null;
        }
      });
      // Checkbox: absent from formData entirely when unchecked, so this
      // can't reuse the text-field loop above (an absent value there means
      // "field untouched", not "false").
      updateData.is_content_creator = formData.get("is_content_creator") === "on";

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

    } else if (formType === "faceitLookup") {
      const nickname = String(formData.get("faceit_nickname") || "").trim();
      if (!nickname) {
        return { error: t("action_messages.no_nickname") };
      }
      const response = await authFetch(`/players/faceit-lookup/?nickname=${encodeURIComponent(nickname)}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      const lookupResult: FaceitLookupResult = await response.json();
      return { lookupResult };

    } else if (formType === "playerProfileUpdate") {
      const faceit_player_id = formData.get("faceit_player_id");
      const description = formData.get("description");
      const hasExistingPlayer = formData.get("_hasExistingPlayer") === "true";
      const payload: Record<string, unknown> = {
        faceit_player_id: faceit_player_id === "" ? null : faceit_player_id,
        description: description === "" ? null : description,
        show_extended_profile: formData.get("show_extended_profile") === "on",
      };
      // ingame_name only defaults to the account username on first creation -
      // once a player has a profile, later saves here (e.g. just toggling
      // visibility or editing the bio) must never silently overwrite a
      // display name someone may have deliberately customized since.
      if (!hasExistingPlayer) {
        payload.ingame_name = String(formData.get("ingame_name") || "");
      }

      const response = await authFetch(`/players/me/`, {
        method: hasExistingPlayer ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: t("action_messages.faceit_updated") };

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
  const loaderData = useLoaderData() as { user: UserProfile | null; error?: string; socialChannels: SocialChannel[]; player: PlayerProfile | null };
  const actionData = useActionData() as { error?: string; success?: string; lookupResult?: FaceitLookupResult } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const { t } = useTranslation("profile");

  const { user, error: loaderError, socialChannels, player } = loaderData;
  // Once a lookup resolves a nickname to a player_id, that becomes what
  // "Speichern" actually submits - overriding whatever was already linked.
  const faceitLookupResult = actionData?.lookupResult ?? null;
  const resolvedFaceitId = faceitLookupResult?.player_id ?? player?.faceit_player_id ?? "";
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

  const handleProfilePictureCropped = (file: File | null) => {
    if (file) {
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
            {user.team_id && (
              <li className="mb-4">
                <a href="/praccs" className="block text-gray-300 hover:text-white transition-colors duration-200">
                  Meine Praccs
                </a>
              </li>
            )}
            <li className="mb-4">
              <a href="/util-training" className="block text-gray-300 hover:text-white transition-colors duration-200">
                Util-Training
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
                    <ImageCropInput
                      id="profile_picture"
                      name="profile_picture"
                      aspect={1}
                      outputWidth={512}
                      outputHeight={512}
                      onCropped={handleProfilePictureCropped}
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
                    placeholder={t("details.game_profile_link_placeholder")}
                    defaultValue={user.game_profile_link || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t("details.game_profile_link_hint")}</p>
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

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-1">{t("details.creator_heading")}</h3>
                <p className="text-gray-400 text-sm mb-4">{t("details.creator_hint")}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_content_creator"
                    name="is_content_creator"
                    defaultChecked={user.is_content_creator}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500"
                  />
                  <label htmlFor="is_content_creator" className="text-sm text-gray-300">{t("details.is_content_creator_label")}</label>
                </div>
                <div className="mt-4">
                  <label htmlFor="creator_bio" className="block text-sm font-medium text-gray-300">{t("details.creator_bio_label")}</label>
                  <textarea
                    id="creator_bio"
                    name="creator_bio"
                    rows={3}
                    defaultValue={user.creator_bio || ""}
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

          {/* FACEIT-Profil - unabhängig von Team-Mitgliedschaft, siehe
              GET/POST/PUT /players/me/ (fastapi_app/main.py). Die FACEIT
              player_id ist als Nutzer praktisch nicht auffindbar, daher wird
              sie hier per Nickname-Suche (GET /players/faceit-lookup/)
              aufgelöst statt manuell eingegeben. */}
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <h2 className="text-3xl font-bold text-white">{t("faceit.heading")}</h2>
              {player && (
                <a href={`/players/${player.id}`} className="text-sm text-red-500 hover:text-red-400 font-semibold">
                  {t("faceit.view_public_profile")}
                </a>
              )}
            </div>
            <p className="text-gray-400 text-sm mb-6">{t("faceit.description")}</p>
            <Form method="post" className="space-y-6">
              <input type="hidden" name="_hasExistingPlayer" value={player ? "true" : "false"} />
              <input type="hidden" name="faceit_player_id" value={resolvedFaceitId} />
              {/* Kein eigenes Ingame-Name-Feld mehr - Benutzername und
                  Ingame-Name sind für diese Seite dasselbe, der Benutzername
                  wird 1:1 als Player.ingame_name übernommen. */}
              <input type="hidden" id="ingame_name" name="ingame_name" value={user.username} />
              <div>
                <label htmlFor="faceit_nickname" className="block text-sm font-medium text-gray-300">{t("faceit.faceit_nickname_label")}</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    id="faceit_nickname"
                    name="faceit_nickname"
                    defaultValue={faceitLookupResult?.nickname || ""}
                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                  <button
                    type="submit"
                    name="_formType"
                    value="faceitLookup"
                    disabled={isSubmitting}
                    className="flex-shrink-0 py-2 px-4 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-white bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    {isSubmitting && navigation.formData?.get("_formType") === "faceitLookup" ? t("faceit.searching") : t("faceit.search")}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">{t("faceit.faceit_nickname_hint")}</p>

                {faceitLookupResult && (
                  <div className="mt-3 flex items-center gap-3 bg-gray-900/50 rounded-md p-3">
                    {faceitLookupResult.avatar && (
                      <img src={faceitLookupResult.avatar} alt={faceitLookupResult.nickname} className="w-10 h-10 rounded-full object-cover" />
                    )}
                    <div>
                      <p className="text-sm text-gray-400">{t("faceit.found_heading")}</p>
                      <p className="text-white font-semibold">{faceitLookupResult.nickname}</p>
                      {faceitLookupResult.skill_level != null && (
                        <p className="text-xs text-gray-400">
                          {t("faceit.found_level", { level: faceitLookupResult.skill_level, elo: faceitLookupResult.faceit_elo })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {!faceitLookupResult && player?.faceit_player_id && (
                  <p className="mt-2 text-xs text-gray-500">{t("faceit.already_linked", { id: player.faceit_player_id })}</p>
                )}
              </div>

              <div className="border-t border-gray-700 pt-6">
                <h3 className="text-lg font-semibold text-white mb-1">{t("faceit.public_profile_heading")}</h3>
                <p className="text-gray-400 text-sm mb-4">{t("faceit.public_profile_hint")}</p>
                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-300">{t("faceit.description_label")}</label>
                  <textarea
                    id="description"
                    name="description"
                    rows={4}
                    defaultValue={player?.description || ""}
                    className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <input
                    type="checkbox"
                    id="show_extended_profile"
                    name="show_extended_profile"
                    defaultChecked={player?.show_extended_profile || false}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500"
                  />
                  <label htmlFor="show_extended_profile" className="text-sm text-gray-300">{t("faceit.show_extended_profile_label")}</label>
                </div>
                <p className="mt-1 text-xs text-gray-500">{t("faceit.show_extended_profile_hint")}</p>
              </div>

              <button
                type="submit"
                name="_formType"
                value="playerProfileUpdate"
                disabled={isSubmitting}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting && navigation.formData?.get("_formType") === "playerProfileUpdate" ? t("faceit.saving") : t("faceit.save")}
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

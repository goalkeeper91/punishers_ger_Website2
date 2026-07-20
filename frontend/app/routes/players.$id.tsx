import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";

// Public player profile - GET /players/{id}/ is unauthenticated by design and
// only ever returns what the player themselves (or their Teammanager, for a
// guest with no account) chose to make public. Image, ingame_name, role and
// team/game are always included; description/username/social links are only
// present when show_extended_profile is true (see fastapi_app/main.py's
// build_public_player_profile_schema) - so there's nothing to gate here on
// the frontend, the API already omits anything not opted into.
interface PublicPlayerProfile {
  id: number;
  ingame_name: string;
  role: string | null;
  image_url: string | null;
  team_id: number | null;
  team_name: string | null;
  team_game: string | null;
  show_extended_profile: boolean;
  description: string | null;
  username: string | null;
  game_profile_link: string | null;
  twitter_link: string | null;
  twitch_link: string | null;
  youtube_link: string | null;
  instagram_link: string | null;
  tiktok_link: string | null;
}

export const loader: LoaderFunction = async ({ params }) => {
  const response = await fetch(`${API_BASE_URL}/players/${params.id}/`);
  if (!response.ok) {
    if (response.status === 404) {
      return { player: null };
    }
    throw new Response("Fehler beim Laden des Spielerprofils", { status: response.status });
  }
  const player: PublicPlayerProfile = await response.json();
  return { player };
};

export default function PublicPlayerProfilePage() {
  const { player } = useLoaderData() as { player: PublicPlayerProfile | null };
  const { t } = useTranslation("players");

  if (!player) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
        <h1 className="text-4xl font-bold text-white">{t("not_found")}</h1>
      </div>
    );
  }

  const links = [
    { href: player.twitch_link, label: "Twitch" },
    { href: player.twitter_link, label: "Twitter" },
    { href: player.youtube_link, label: "YouTube" },
    { href: player.instagram_link, label: "Instagram" },
    { href: player.tiktok_link, label: "TikTok" },
    { href: player.game_profile_link, label: t("game_profile_link_label") },
  ].filter((link) => link.href);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl">
          <div className="flex flex-col items-center text-center gap-3">
            <img
              className="h-32 w-32 rounded-full object-cover border-4 border-red-600"
              src={player.image_url || imageFallback(`https://via.placeholder.com/150?text=${encodeURIComponent(player.ingame_name)}`)}
              alt={player.ingame_name}
            />
            <h1 className="text-3xl font-bold text-white">{player.ingame_name}</h1>
            {player.username && <p className="text-gray-500 text-sm -mt-2">@{player.username}</p>}
            {player.role && (
              <p className="text-red-500 text-sm font-semibold uppercase tracking-wide">{player.role}</p>
            )}

            <div className="text-gray-400 text-sm">
              {player.team_id ? (
                <a href={`/teams/${player.team_id}`} className="hover:text-white transition-colors duration-300">
                  {player.team_name}
                  {player.team_game && ` · ${player.team_game}`}
                </a>
              ) : (
                t("no_team")
              )}
            </div>

            {player.description && (
              <p className="text-gray-300 text-base mt-4 whitespace-pre-line">{player.description}</p>
            )}

            {links.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-4 mt-2">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-red-600 transition-colors duration-300"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : (
              !player.description && (
                <p className="text-gray-600 text-sm mt-4 italic">{t("no_extra_info")}</p>
              )
            )}
          </div>

          {player.team_id && (
            <div className="mt-8 text-center">
              <a href={`/teams/${player.team_id}`} className="text-gray-400 hover:text-white text-sm">
                ← {t("back_to_team")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

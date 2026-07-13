import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";

interface Player {
  id: number;
  ingame_name: string;
  role: string | null;
  description: string | null;
  image_url: string | null;
  team_id: number | null;
  user: {
    id: number;
    username: string;
    email: string;
    profile_picture_url: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

interface Team {
  id: number;
  name: string;
  game: string;
  description: string | null;
  image_url: string | null;
  is_main_team: boolean;
  players: Player[];
  created_at: string;
  updated_at: string;
}

export const loader: LoaderFunction = async ({ params }) => {
  const response = await fetch(`${API_BASE_URL}/teams/${params.id}/`);
  if (!response.ok) {
    throw new Response("Team nicht gefunden", { status: response.status });
  }
  const team: Team = await response.json();
  return { team };
};

export default function TeamDetailPage() {
  const { team } = useLoaderData() as { team: Team };
  const { t } = useTranslation("teams");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        <section
          className="relative py-20 md:py-32 bg-cover bg-center text-center"
          style={{ backgroundImage: `url('${team.image_url || imageFallback("https://via.placeholder.com/1920x400?text=" + encodeURIComponent(team.name))}')` }}
        >
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            {team.is_main_team && (
              <p className="text-red-500 text-sm font-semibold uppercase tracking-wider mb-2">{t("detail.main_team_badge")}</p>
            )}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{team.name}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto uppercase tracking-wide">{team.game}</p>
          </div>
        </section>

        {team.description && (
          <section className="py-12 bg-gray-900">
            <div className="container mx-auto px-4 max-w-3xl text-center">
              <p className="text-gray-300 text-lg whitespace-pre-line">{team.description}</p>
            </div>
          </section>
        )}

        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-white mb-10 text-center">{t("detail.roster_heading")}</h2>
            {team.players.length === 0 ? (
              <p className="text-gray-500 text-center">{t("detail.no_players")}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                {team.players.map((player) => (
                  <div key={player.id} className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center text-center transform hover:scale-105 transition-transform duration-300">
                    <img
                      src={
                        player.image_url ||
                        player.user?.profile_picture_url ||
                        `https://via.placeholder.com/150?text=${encodeURIComponent(player.ingame_name)}`
                      }
                      alt={player.ingame_name}
                      className="w-28 h-28 rounded-full object-cover mb-4 border-4 border-red-600"
                    />
                    <h3 className="text-xl font-bold text-white">{player.ingame_name}</h3>
                    {player.role && <p className="text-red-500 text-sm font-semibold uppercase mt-1">{player.role}</p>}
                    {player.description && <p className="text-gray-400 text-sm mt-3">{player.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="container mx-auto px-4 pb-16 text-center">
          <a href="/teams" className="text-gray-400 hover:text-white text-sm">← {t("detail.back_to_teams")}</a>
        </div>
      </main>
    </div>
  );
}

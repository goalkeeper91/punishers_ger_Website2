import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";
import { fetchPageBackground } from "~/lib/siteSettings";

// Removed Remix-specific MetaFunction
// export const meta: MetaFunction = () => {
//   return [
//     { title: "Unsere Teams - Punishers Germany" },
//     { name: "description", content: "Entdecke die Esport-Teams von Punishers Germany. Finde Main Teams und filtere nach Spielen wie CS2, Valorant und League of Legends." },
//   ];
// };

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

export const loader: LoaderFunction = async () => {
  const backgroundUrl = await fetchPageBackground("teams");
  try {
    const response = await fetch(`${API_BASE_URL}/teams/`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const teams: Team[] = await response.json();

    // Separate main teams from other teams
    const mainTeams = teams.filter(team => team.is_main_team);
    const otherTeams = teams.filter(team => !team.is_main_team);

    return { mainTeams, otherTeams, backgroundUrl };
  } catch (error) {
    console.error("Failed to fetch teams:", error);
    return { mainTeams: [], otherTeams: [], backgroundUrl };
  }
};

export default function TeamsPage() {
  const { mainTeams, otherTeams, backgroundUrl } = useLoaderData() as { mainTeams: Team[], otherTeams: Team[], backgroundUrl: string | null };
  const { t } = useTranslation("teams");

  const games = [t("filter.all_games"), "Counter-Strike 2", "Valorant", "League of Legends", "Rocket League", "Rainbow Six Siege"]; // Game titles are proper nouns, not translated

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Teams */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: `url('${backgroundUrl || "https://via.placeholder.com/1920x400?text=Teams+Banner"}')` }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Game Filter Section */}
        <section className="py-12 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-3xl font-bold text-white mb-6">{t("filter.heading")}</h2>
            <div className="flex flex-wrap justify-center gap-4">
              {games.map((game) => (
                <button
                  key={game}
                  className="px-6 py-3 rounded-full bg-gray-800 text-gray-300 hover:bg-red-600 hover:text-white transition-colors duration-300 text-lg font-semibold"
                >
                  {game}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Main Teams Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("main_teams.heading")}</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              {t("main_teams.description")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {mainTeams.map((team) => (
                <div key={team.id} className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                  <img src={team.image_url || imageFallback("https://via.placeholder.com/400x250?text=No+Image")} alt={team.name} className="w-full h-56 object-cover" />
                  <div className="p-6">
                    <h3 className="text-2xl font-bold text-white mb-2">{team.name}</h3>
                    <p className="text-red-600 text-sm font-semibold uppercase mb-3">{team.game}</p>
                    <a href={`/teams/${team.id}`} className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                      {t("main_teams.team_profile")}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Other Teams Section / Call to Action for more teams */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("other_teams.heading")}</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              {t("other_teams.description")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {otherTeams.map((team) => (
                <div key={team.id} className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                  <img src={team.image_url || imageFallback("https://via.placeholder.com/300x200?text=No+Image")} alt={team.name} className="w-full h-40 object-cover" />
                  <div className="p-4">
                    <h3 className="text-xl font-bold text-white mb-1">{team.name}</h3>
                    <p className="text-red-600 text-xs font-semibold uppercase mb-3">{team.game}</p>
                    <a href={`/teams/${team.id}`} className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-4 rounded-full text-xs transition-colors duration-300">
                      {t("other_teams.details")}
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-12">
              <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
                {t("other_teams.show_all")}
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

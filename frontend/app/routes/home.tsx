import type { LoaderFunction, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import HeroBackground from "~/components/HeroBackground";
import SponsorRotation from "~/components/SponsorRotation";
import MatchHighlightWidget from "~/components/MatchHighlightWidget";
import {
  fetchActiveSponsors,
  fetchMatchHighlights,
  fetchMainTeams,
  fetchCreators,
  type Sponsor,
  type MatchHighlight,
  type TeamTeaser,
  type Creator,
} from "~/lib/publicContent";
import { fetchHeroVideoUrl } from "~/lib/siteSettings";

export const meta: MetaFunction = () => {
  return [
    { title: "Punishers Germany - Esport Organisation" },
    { name: "description", content: "Deine neue Heimat im Esport. Werde Teil der Punishers Germany Familie!" },
  ];
};

export const loader: LoaderFunction = async () => {
  const [sponsors, matchHighlights, heroVideoUrl, mainTeams, creators] = await Promise.all([
    fetchActiveSponsors(),
    fetchMatchHighlights(),
    fetchHeroVideoUrl(),
    fetchMainTeams(),
    fetchCreators(),
  ]);
  return { sponsors, matchHighlights, heroVideoUrl, mainTeams, creators };
};

export default function Home() {
  const { sponsors, matchHighlights, heroVideoUrl, mainTeams, creators } = useLoaderData() as {
    sponsors: Sponsor[];
    matchHighlights: MatchHighlight[];
    heroVideoUrl: string | null;
    mainTeams: TeamTeaser[];
    creators: Creator[];
  };
  const featuredCreators = creators.filter((c) => c.is_featured).slice(0, 3);
  const teaserTeams = mainTeams.slice(0, 3);
  const { t } = useTranslation("home");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <MatchHighlightWidget highlights={matchHighlights} />

      <main>
        {/* Hero Section */}
        <section id="home" className="relative min-h-[85vh] md:min-h-[90vh] flex items-center justify-center text-center overflow-hidden">
          <HeroBackground posterUrl="https://via.placeholder.com/1920x1080?text=Esport+Arena+Background" videoUrl={heroVideoUrl} />
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 p-6 sm:p-8 max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-white leading-tight mb-4">{t("hero.title")}</h1>
            <h2 className="text-xl sm:text-2xl md:text-4xl font-semibold text-red-600 mb-6">{t("hero.subtitle")}</h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-300 mb-8">
              {t("hero.description")}
            </p>
            <a href="/#join-us" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              {t("hero.cta")}
            </a>
          </div>
        </section>

        {/* Sponsor Rotation - prominent partner showcase right below the hero */}
        <SponsorRotation sponsors={sponsors} />

        {/* Teams Section - main teams only, real data (full roster on /teams) */}
        {teaserTeams.length > 0 && (
          <section id="teams" className="py-16 md:py-24 bg-gray-900">
            <div className="container mx-auto px-4 text-center">
              <h2 className="text-4xl font-bold text-white mb-6">{t("teams_section.heading")}</h2>
              <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                {t("teams_section.description")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {teaserTeams.map((team) => (
                  <div key={team.id} className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                    <img
                      src={team.image_url || `https://via.placeholder.com/600x400?text=${encodeURIComponent(team.name)}`}
                      alt={team.name}
                      className="w-full h-48 object-cover"
                    />
                    <div className="p-6 text-left">
                      <h3 className="text-2xl font-bold text-white mb-1">{team.name}</h3>
                      <p className="text-sm text-red-500 font-semibold mb-3">{team.game}</p>
                      {team.description && <p className="text-gray-300 mb-4">{team.description}</p>}
                      <a href={`/teams/${team.id}`} className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                        {t("teams_section.learn_more")}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Content Creators Section - real, featured creators only (full list on /creators) */}
        {featuredCreators.length > 0 && (
          <section id="creators" className="py-16 md:py-24 bg-gray-950">
            <div className="container mx-auto px-4 text-center">
              <h2 className="text-4xl font-bold text-white mb-6">{t("creators_section.heading")}</h2>
              <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                {t("creators_section.description")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {featuredCreators.map((creator) => (
                  <div key={creator.id} className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                    <img
                      src={creator.profile_picture_url || `https://via.placeholder.com/150?text=${encodeURIComponent(creator.username)}`}
                      alt={creator.username}
                      className="w-32 h-32 rounded-full object-cover mb-4 border-4 border-red-600"
                    />
                    <h3 className="text-2xl font-bold text-white mb-2">{creator.username}</h3>
                    {creator.bio && <p className="text-gray-300 text-center mb-4">{creator.bio}</p>}
                    <div className="flex space-x-4">
                      {creator.twitch_link && (
                        <a href={creator.twitch_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitch</a>
                      )}
                      {creator.youtube_link && (
                        <a href={creator.youtube_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">YouTube</a>
                      )}
                      {creator.twitter_link && (
                        <a href={creator.twitter_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitter</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Join Us Section */}
        <section id="join-us" className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("join_section.heading")}</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-3xl mx-auto">
              {t("join_section.description")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Join Card 1 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">{t("join_section.player_title")}</h3>
                <p className="text-gray-300 mb-6">{t("join_section.player_description")}</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  {t("join_section.player_cta")}
                </a>
              </div>
              {/* Join Card 2 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">{t("join_section.creator_title")}</h3>
                <p className="text-gray-300 mb-6">{t("join_section.creator_description")}</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  {t("join_section.creator_cta")}
                </a>
              </div>
              {/* Join Card 3 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">{t("join_section.community_title")}</h3>
                <p className="text-gray-300 mb-6">{t("join_section.community_description")}</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  {t("join_section.community_cta")}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section (simple placeholder) */}
        <section id="contact" className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("contact_section.heading")}</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto">
              {t("contact_section.description")}
            </p>
            <a href="mailto:info@punishers-germany.de" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              {t("contact_section.cta")}
            </a>
          </div>
        </section>
      </main>

    </div>
  );
}

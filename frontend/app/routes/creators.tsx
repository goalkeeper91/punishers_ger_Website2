// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Unsere Content Creators - Punishers Germany" },
//     { name: "description", content: "Entdecke die Content Creators von Punishers Germany. Streamer, YouTuber und mehr, die unsere Community unterhalten." },
//   ];
// };

import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchCreators, type Creator } from "~/lib/publicContent";

export const loader: LoaderFunction = async () => {
  const creators = await fetchCreators();
  return { creators };
};

function LiveBadge({ creator }: { creator: Creator }) {
  const { t } = useTranslation("creators");
  if (!creator.live) return null;
  return (
    <a
      href={creator.twitch_link ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex w-full items-center gap-2 rounded-lg bg-red-600/10 border border-red-600 px-3 py-2 text-left hover:bg-red-600/20 transition-colors duration-300"
    >
      <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-red-600 animate-pulse" />
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-wide text-red-500">
          {t("live.badge")}{creator.live.viewer_count != null ? ` · ${t("live.viewers", { count: creator.live.viewer_count })}` : ""}
        </span>
        {creator.live.title && (
          <span className="block truncate text-xs text-gray-300">{creator.live.title}</span>
        )}
      </span>
    </a>
  );
}

function SocialLinks({ creator, size = "base" }: { creator: Creator; size?: "base" | "sm" }) {
  const textClass = size === "sm" ? "text-sm" : "";
  return (
    <div className={`flex space-x-4 ${size === "sm" ? "space-x-3" : ""}`}>
      {creator.twitch_link && (
        <a href={creator.twitch_link} target="_blank" rel="noopener noreferrer" className={`text-gray-400 hover:text-red-600 transition-colors duration-300 ${textClass}`}>
          Twitch
        </a>
      )}
      {creator.youtube_link && (
        <a href={creator.youtube_link} target="_blank" rel="noopener noreferrer" className={`text-gray-400 hover:text-red-600 transition-colors duration-300 ${textClass}`}>
          YouTube
        </a>
      )}
      {creator.twitter_link && (
        <a href={creator.twitter_link} target="_blank" rel="noopener noreferrer" className={`text-gray-400 hover:text-red-600 transition-colors duration-300 ${textClass}`}>
          Twitter
        </a>
      )}
    </div>
  );
}

export default function CreatorsPage() {
  const { creators } = useLoaderData() as { creators: Creator[] };
  const { t } = useTranslation("creators");
  const featuredCreators = creators.filter((c) => c.is_featured);
  const otherCreators = creators.filter((c) => !c.is_featured);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Creators */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Creators+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {creators.length === 0 ? (
          <section className="py-16 md:py-24 bg-gray-900">
            <div className="container mx-auto px-4 text-center">
              <p className="text-gray-500">{t("empty")}</p>
            </div>
          </section>
        ) : (
          <>
            {/* Featured Creators Section */}
            {featuredCreators.length > 0 && (
              <section className="py-16 md:py-24 bg-gray-900">
                <div className="container mx-auto px-4 text-center">
                  <h2 className="text-4xl font-bold text-white mb-6">{t("featured.heading")}</h2>
                  <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                    {t("featured.description")}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {featuredCreators.map((creator) => (
                      <div key={creator.id} className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                        <img
                          src={creator.profile_picture_url || `https://via.placeholder.com/300x300?text=${encodeURIComponent(creator.username)}`}
                          alt={creator.username}
                          className="w-36 h-36 rounded-full object-cover mb-4 border-4 border-red-600"
                        />
                        <h3 className="text-2xl font-bold text-white mb-2">{creator.username}</h3>
                        {creator.bio && <p className="text-gray-300 text-center mb-4">{creator.bio}</p>}
                        <SocialLinks creator={creator} />
                        <LiveBadge creator={creator} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* All Creators Section */}
            {otherCreators.length > 0 && (
              <section className="py-16 md:py-24 bg-gray-950">
                <div className="container mx-auto px-4 text-center">
                  <h2 className="text-4xl font-bold text-white mb-6">{t("all.heading")}</h2>
                  <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                    {t("all.description")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                    {otherCreators.map((creator) => (
                      <div key={creator.id} className="bg-gray-800 rounded-lg shadow-xl p-4 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                        <img
                          src={creator.profile_picture_url || `https://via.placeholder.com/150?text=${encodeURIComponent(creator.username)}`}
                          alt={creator.username}
                          className="w-24 h-24 rounded-full object-cover mb-3 border-2 border-red-600"
                        />
                        <h3 className="text-xl font-bold text-white mb-1">{creator.username}</h3>
                        <SocialLinks creator={creator} size="sm" />
                        <LiveBadge creator={creator} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

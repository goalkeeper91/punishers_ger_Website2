// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Unsere Sponsoren - Punishers Germany" },
//     { name: "description", content: "Entdecke die Partner und Sponsoren von Punishers Germany. Werde Teil unseres Erfolgs und unterstütze unsere Esport-Organisation." },
//   ];
// };

import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchActiveSponsors, trackSponsorClick, type Sponsor } from "~/lib/publicContent";
import { fetchPageBackground } from "~/lib/siteSettings";

export const loader: LoaderFunction = async () => {
  const [sponsors, backgroundUrl] = await Promise.all([
    fetchActiveSponsors(),
    fetchPageBackground("sponsors"),
  ]);
  return { sponsors, backgroundUrl };
};

function SponsorLogo({ sponsor }: { sponsor: Sponsor }) {
  const img = (
    <img
      src={sponsor.logo_url || `https://via.placeholder.com/200x100?text=${encodeURIComponent(sponsor.name)}`}
      alt={sponsor.name}
      className="max-h-full max-w-full object-contain"
    />
  );
  if (!sponsor.website_url) return img;
  return (
    <a href={sponsor.website_url} target="_blank" rel="noopener noreferrer" onClick={() => trackSponsorClick(sponsor.id)}>
      {img}
    </a>
  );
}

export default function SponsorsPage() {
  const { sponsors, backgroundUrl } = useLoaderData() as { sponsors: Sponsor[]; backgroundUrl: string | null };
  const { t } = useTranslation("sponsors");
  const premiumSponsors = sponsors.filter((s) => s.tier === "premium");
  const generalSponsors = sponsors.filter((s) => s.tier === "general");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Sponsors */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: `url('${backgroundUrl || "https://via.placeholder.com/1920x400?text=Sponsors+Banner"}')` }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Premium Sponsors Section */}
        {premiumSponsors.length > 0 && (
          <section className="py-16 md:py-24 bg-gray-900">
            <div className="container mx-auto px-4 text-center">
              <h2 className="text-4xl font-bold text-white mb-6">{t("premium.heading")}</h2>
              <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                {t("premium.description")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center justify-center">
                {premiumSponsors.map((sponsor) => (
                  <div key={sponsor.id} className="p-6 bg-gray-800 rounded-lg shadow-xl flex items-center justify-center h-40 transform hover:scale-105 transition-transform duration-300">
                    <SponsorLogo sponsor={sponsor} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* All Sponsors Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("all.heading")}</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              {t("all.description")}
            </p>
            {generalSponsors.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8 items-center justify-center">
                {generalSponsors.map((sponsor) => (
                  <div key={sponsor.id} className="p-4 bg-gray-800 rounded-lg shadow-md flex items-center justify-center h-32 transform hover:scale-105 transition-transform duration-300">
                    <SponsorLogo sponsor={sponsor} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">{t("all.empty")}</p>
            )}
          </div>
        </section>

        {/* Become a Sponsor Section */}
        <section className="py-16 md:py-24 bg-gray-900 text-center">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl font-bold text-white mb-6">{t("become.heading")}</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-3xl mx-auto">
              {t("become.description")}
            </p>
            <a href="/contact" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              {t("become.cta")}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

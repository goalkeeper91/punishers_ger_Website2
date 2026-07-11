// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Unsere Sponsoren - Punishers Germany" },
//     { name: "description", content: "Entdecke die Partner und Sponsoren von Punishers Germany. Werde Teil unseres Erfolgs und unterstütze unsere Esport-Organisation." },
//   ];
// };

import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { fetchActiveSponsors, trackSponsorClick, type Sponsor } from "~/lib/publicContent";

export const loader: LoaderFunction = async () => {
  const sponsors = await fetchActiveSponsors();
  return { sponsors };
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
  const { sponsors } = useLoaderData() as { sponsors: Sponsor[] };
  const premiumSponsors = sponsors.filter((s) => s.tier === "premium");
  const generalSponsors = sponsors.filter((s) => s.tier === "general");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Sponsors */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Sponsors+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4">Unsere Partner & Sponsoren</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Wir sind stolz auf unsere starken Partnerschaften, die uns auf unserem Weg zum Erfolg unterstützen.
            </p>
          </div>
        </section>

        {/* Premium Sponsors Section */}
        {premiumSponsors.length > 0 && (
          <section className="py-16 md:py-24 bg-gray-900">
            <div className="container mx-auto px-4 text-center">
              <h2 className="text-4xl font-bold text-white mb-6">Premium Partner</h2>
              <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
                Ein besonderer Dank gilt unseren Premium-Sponsoren, die maßgeblich zu unserem Wachstum beitragen.
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
            <h2 className="text-4xl font-bold text-white mb-6">Alle unsere Sponsoren</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              Jeder Partner ist ein wichtiger Teil unserer Punishers Germany Familie.
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
              <p className="text-gray-500">Noch keine weiteren Sponsoren.</p>
            )}
          </div>
        </section>

        {/* Become a Sponsor Section */}
        <section className="py-16 md:py-24 bg-gray-900 text-center">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl font-bold text-white mb-6">Werde unser Partner!</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-3xl mx-auto">
              Möchtest du deine Marke mit einer dynamischen und wachsenden Esport-Organisation verbinden? Kontaktiere uns, um mehr über unsere Partnerschaftsmöglichkeiten zu erfahren.
            </p>
            <a href="/contact" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              Partnerschaft anfragen
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

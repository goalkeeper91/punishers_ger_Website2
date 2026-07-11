import type { LoaderFunction, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import HeroBackground from "~/components/HeroBackground";
import SponsorRotation from "~/components/SponsorRotation";
import MatchHighlightWidget from "~/components/MatchHighlightWidget";
import { fetchActiveSponsors, fetchMatchHighlights, type Sponsor, type MatchHighlight } from "~/lib/publicContent";

export const meta: MetaFunction = () => {
  return [
    { title: "Punishers Germany - Esport Organisation" },
    { name: "description", content: "Deine neue Heimat im Esport. Werde Teil der Punishers Germany Familie!" },
  ];
};

export const loader: LoaderFunction = async () => {
  const [sponsors, matchHighlights] = await Promise.all([
    fetchActiveSponsors(),
    fetchMatchHighlights(),
  ]);
  return { sponsors, matchHighlights };
};

export default function Home() {
  const { sponsors, matchHighlights } = useLoaderData() as { sponsors: Sponsor[]; matchHighlights: MatchHighlight[] };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <MatchHighlightWidget highlights={matchHighlights} />

      <main>
        {/* Hero Section */}
        <section id="home" className="relative min-h-[85vh] md:min-h-[90vh] flex items-center justify-center text-center overflow-hidden">
          <HeroBackground posterUrl="https://via.placeholder.com/1920x1080?text=Esport+Arena+Background" />
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 p-6 sm:p-8 max-w-4xl mx-auto">
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-white leading-tight mb-4">Punishers Germany</h1>
            <h2 className="text-xl sm:text-2xl md:text-4xl font-semibold text-red-600 mb-6">Deine neue Heimat im Esport</h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-300 mb-8">
              Wir sind eine aufstrebende Esport-Organisation, die Talente fördert und eine leidenschaftliche Community aufbaut. Werde Teil unserer Reise!
            </p>
            <a href="/#join-us" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              Jetzt beitreten!
            </a>
          </div>
        </section>

        {/* Sponsor Rotation - prominent partner showcase right below the hero */}
        <SponsorRotation sponsors={sponsors} />

        {/* Teams Section (This section is now redundant if /teams is a separate page, but keeping for consistency with previous request) */}
        <section id="teams" className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Unsere Teams</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              Lerne die Spieler kennen, die uns auf dem Schlachtfeld vertreten und unsere Farben mit Stolz tragen.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Team Card 1 */}
              <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/600x400?text=Team+CS2" alt="Team CS2" className="w-full h-48 object-cover" />
                <div className="p-6">
                  <h3 className="text-2xl font-bold text-white mb-2">CS2 Squad</h3>
                  <p className="text-gray-300 mb-4">Unsere Counter-Strike 2 Profis dominieren die Server mit Präzision und Teamwork.</p>
                  <a href="/teams" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                    Mehr erfahren
                  </a>
                </div>
              </div>
              {/* Team Card 2 */}
              <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/600x400?text=Team+Valorant" alt="Team Valorant" className="w-full h-48 object-cover" />
                <div className="p-6">
                  <h3 className="text-2xl font-bold text-white mb-2">Valorant Elite</h3>
                  <p className="text-gray-300 mb-4">Schnelle Reflexe und taktisches Geschick zeichnen unser Valorant Team aus.</p>
                  <a href="/teams" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                    Mehr erfahren
                  </a>
                </div>
              </div>
              {/* Team Card 3 */}
              <div className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/600x400?text=Team+LoL" alt="Team League of Legends" className="w-full h-48 object-cover" />
                <div className="p-6">
                  <h3 className="text-2xl font-bold text-white mb-2">League of Legends</h3>
                  <p className="text-gray-300 mb-4">Strategie und Koordination sind der Schlüssel zum Erfolg unseres LoL-Teams.</p>
                  <a href="/teams" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                    Mehr erfahren
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Content Creators Section */}
        <section id="creators" className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Unsere Content Creators</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              Entdecke die Persönlichkeiten, die unsere Community unterhalten, inspirieren und unsere Werte in die Welt tragen.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Creator Card 1 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Creator+1" alt="Content Creator 1" className="w-32 h-32 rounded-full object-cover mb-4 border-4 border-red-600" />
                <h3 className="text-2xl font-bold text-white mb-2">GamerGirl_X</h3>
                <p className="text-gray-300 text-center mb-4">Streamt täglich Shooter und RPGs. Folgt ihr für spannende Unterhaltung!</p>
                <div className="flex space-x-4">
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitch</a>
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">YouTube</a>
                </div>
              </div>
              {/* Creator Card 2 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Creator+2" alt="Content Creator 2" className="w-32 h-32 rounded-full object-cover mb-4 border-4 border-red-600" />
                <h3 className="text-2xl font-bold text-white mb-2">EsportAnalyst</h3>
                <p className="text-gray-300 text-center mb-4">Taktikanalysen und Highlights aus der Esport-Welt. Immer auf dem neuesten Stand.</p>
                <div className="flex space-x-4">
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">YouTube</a>
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitter</a>
                </div>
              </div>
              {/* Creator Card 3 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Creator+3" alt="Content Creator 3" className="w-32 h-32 rounded-full object-cover mb-4 border-4 border-red-600" />
                <h3 className="text-2xl font-bold text-white mb-2">RetroGamer_DE</h3>
                <p className="text-gray-300 text-center mb-4">Liebhaber klassischer Spiele und entspannter Streams. Nostalgie pur!</p>
                <div className="flex space-x-4">
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">Twitch</a>
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 transition-colors duration-300">YouTube</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Join Us Section */}
        <section id="join-us" className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Werde Teil der Punishers Germany Familie!</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-3xl mx-auto">
              Egal ob du ein aufstrebender Esportler, ein kreativer Content Creator oder einfach nur ein leidenschaftlicher Fan bist – wir suchen dich!
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Join Card 1 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Spieler</h3>
                <p className="text-gray-300 mb-6">Du bist ein talentierter Esportler und suchst ein Team, das dich fördert und fordert? Bewirb dich jetzt und zeig uns dein Können!</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  Jetzt bewerben
                </a>
              </div>
              {/* Join Card 2 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Content Creator</h3>
                <p className="text-gray-300 mb-6">Du liebst es, Inhalte zu erstellen, deine Leidenschaft zu teilen und eine Community aufzubauen? Werde Teil unseres Creator-Teams!</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  Mehr Infos
                </a>
              </div>
              {/* Join Card 3 */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 transform hover:scale-105 transition-transform duration-300">
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Community-Mitglied</h3>
                <p className="text-gray-300 mb-6">Werde Teil unserer wachsenden Discord-Community, triff Gleichgesinnte und verpasse keine Neuigkeiten!</p>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full transition-colors duration-300">
                  Discord beitreten
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section (simple placeholder) */}
        <section id="contact" className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Kontaktiere uns</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto">
              Hast du Fragen, Anregungen oder möchtest du mit uns zusammenarbeiten? Wir freuen uns auf deine Nachricht!
            </p>
            <a href="mailto:info@punishers-germany.de" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
              E-Mail senden
            </a>
          </div>
        </section>
      </main>

    </div>
  );
}

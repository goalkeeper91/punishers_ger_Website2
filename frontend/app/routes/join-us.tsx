// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Werde Teil von uns - Punishers Germany" },
//     { name: "description", content: "Werde Spieler, Content Creator oder Community-Mitglied bei Punishers Germany. Finde deine Rolle in unserer Esport-Organisation!" },
//   ];
// };

export default function JoinUsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Join Us */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Join+Us+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4">Werde Teil der Punishers Germany Familie!</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Egal ob du ein aufstrebender Esportler, ein kreativer Content Creator oder einfach nur ein leidenschaftlicher Fan bist – wir suchen dich!
            </p>
          </div>
        </section>

        {/* Join Opportunities Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-12">Deine Möglichkeiten bei uns</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Join Card: Player */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Player" alt="Esport Player" className="w-32 h-32 rounded-full object-cover mb-6 border-4 border-red-600" />
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Spieler</h3>
                <p className="text-gray-300 mb-6">
                  Du bist ein talentierter Esportler, suchst ein professionelles Umfeld und möchtest dein Können auf die nächste Stufe heben? Bewirb dich jetzt für unsere Teams!
                </p>
                <ul className="text-gray-400 text-left mb-6 list-disc list-inside">
                  <li>Professionelles Coaching</li>
                  <li>Team-Infrastruktur</li>
                  <li>Turnierteilnahmen</li>
                  <li>Community-Support</li>
                </ul>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-colors duration-300">
                  Jetzt bewerben
                </a>
              </div>

              {/* Join Card: Content Creator */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Creator" alt="Content Creator" className="w-32 h-32 rounded-full object-cover mb-6 border-4 border-red-600" />
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Content Creator</h3>
                <p className="text-gray-300 mb-6">
                  Du liebst es, Inhalte zu erstellen, deine Leidenschaft zu teilen und eine Community aufzubauen? Werde Teil unseres Creator-Teams und wachse mit uns!
                </p>
                <ul className="text-gray-400 text-left mb-6 list-disc list-inside">
                  <li>Support bei Marketing & Reichweite</li>
                  <li>Zugang zu exklusiven Events</li>
                  <li>Vernetzung mit anderen Creators</li>
                  <li>Möglichkeiten zur Monetarisierung</li>
                </ul>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-colors duration-300">
                  Mehr erfahren
                </a>
              </div>

              {/* Join Card: Community Member */}
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 flex flex-col items-center transform hover:scale-105 transition-transform duration-300">
                <img src="https://via.placeholder.com/150?text=Community" alt="Community Member" className="w-32 h-32 rounded-full object-cover mb-6 border-4 border-red-600" />
                <h3 className="text-3xl font-bold text-red-600 mb-4">Als Community-Mitglied</h3>
                <p className="text-gray-300 mb-6">
                  Werde Teil unserer wachsenden Discord-Community, triff Gleichgesinnte, tausche dich aus und verpasse keine Neuigkeiten und Events!
                </p>
                <ul className="text-gray-400 text-left mb-6 list-disc list-inside">
                  <li>Exklusive Discord-Rollen</li>
                  <li>Teilnahme an Community-Events</li>
                  <li>Direkter Draht zu Spielern & Creators</li>
                  <li>Early Access zu News & Merch</li>
                </ul>
                <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-colors duration-300">
                  Discord beitreten
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Application / Contact Section */}
        <section className="py-16 md:py-24 bg-gray-950 text-center">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl font-bold text-white mb-6">Bereit, den nächsten Schritt zu wagen?</h2>
            <p className="text-lg text-gray-400 mb-8 max-w-3xl mx-auto">
              Wir freuen uns darauf, dich kennenzulernen! Nutze unser Bewerbungsformular oder kontaktiere uns direkt.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-6">
              <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
                Zum Bewerbungsformular
              </a>
              <a href="mailto:info@punishers-germany.de" className="inline-block bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
                E-Mail senden
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

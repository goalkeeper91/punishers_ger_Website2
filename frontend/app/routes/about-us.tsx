// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Über uns - Punishers Germany" },
//     { name: "description", content: "Erfahre mehr über Punishers Germany: Unsere Mission, Werte und die Geschichte hinter unserer Esport-Organisation." },
//   ];
// };

export default function AboutUsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for About Us */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=About+Us+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">Über Punishers Germany</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Unsere Leidenschaft für Esport, unsere Mission und die Werte, die uns antreiben.
            </p>
          </div>
        </section>

        {/* Mission & Vision Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Unsere Mission & Vision</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-12">
              <div className="text-left bg-gray-800 p-8 rounded-lg shadow-xl">
                <h3 className="text-3xl font-bold text-red-600 mb-4">Unsere Mission</h3>
                <p className="text-gray-300 leading-relaxed">
                  Punishers Germany hat es sich zur Aufgabe gemacht, talentierte Esportler zu fördern, eine inklusive und leidenschaftliche Community aufzubauen und den Esport in Deutschland und darüber hinaus voranzutreiben. Wir streben danach, eine Plattform zu bieten, auf der Spieler, Content Creator und Fans gleichermaßen wachsen und ihre Liebe zum Gaming teilen können.
                </p>
              </div>
              <div className="text-left bg-gray-800 p-8 rounded-lg shadow-xl">
                <h3 className="text-3xl font-bold text-red-600 mb-4">Unsere Vision</h3>
                <p className="text-gray-300 leading-relaxed">
                  Wir sehen Punishers Germany als eine führende Esport-Organisation, die nicht nur durch sportliche Erfolge glänzt, sondern auch durch ihre starke Community, ihre innovativen Inhalte und ihre positive Auswirkung auf die Esport-Landschaft. Wir wollen eine Marke sein, die für Exzellenz, Integrität und Zusammenhalt steht.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Our Story Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Unsere Geschichte</h2>
            <div className="max-w-3xl mx-auto text-left bg-gray-800 p-8 rounded-lg shadow-xl">
              <p className="text-gray-300 leading-relaxed mb-4">
                Punishers Germany wurde [Gründungsjahr] von einer Gruppe leidenschaftlicher Gamer gegründet, die eine gemeinsame Vision teilten: eine Esport-Organisation zu schaffen, die sich auf die Entwicklung von Talenten und den Aufbau einer starken Gemeinschaft konzentriert. Was als kleines Projekt begann, wuchs schnell zu einer Organisation heran, die heute Teams in verschiedenen Titeln und eine wachsende Zahl von Content Creatorn umfasst.
              </p>
              <p className="text-gray-300 leading-relaxed">
                Von den ersten Online-Turnieren bis hin zu nationalen Ligen haben wir stets versucht, unsere Spieler bestmöglich zu unterstützen und ihnen die Werkzeuge an die Hand zu geben, die sie für den Erfolg benötigen. Unsere Reise ist noch lange nicht zu Ende, und wir freuen uns auf jedes neue Kapitel, das wir gemeinsam mit unserer Community schreiben werden.
              </p>
            </div>
          </div>
        </section>

        {/* Our Values Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">Unsere Werte</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              Diese Prinzipien leiten uns in allem, was wir tun.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">🏆</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">Exzellenz</h3>
                <p className="text-gray-300">Wir streben in allen Bereichen nach höchster Leistung, sei es im Spiel, in der Content-Erstellung oder in der Organisation.</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">🤝</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">Gemeinschaft</h3>
                <p className="text-gray-300">Wir bauen eine starke, unterstützende und inklusive Community auf, in der sich jeder willkommen fühlt.</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">💡</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">Innovation</h3>
                <p className="text-gray-300">Wir sind stets offen für neue Ideen und Wege, um den Esport voranzubringen und unsere Fans zu begeistern.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

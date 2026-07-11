// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Impressum - Punishers Germany" },
//     { name: "description", content: "Impressum der Esport-Organisation Punishers Germany. Rechtliche Angaben und Kontaktinformationen." },
//   ];
// };

export default function ImprintPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Imprint */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Impressum+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">Impressum</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Hier finden Sie die gesetzlich vorgeschriebenen Angaben zu Punishers Germany.
            </p>
          </div>
        </section>

        {/* Imprint Details Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Angaben gemäß § 5 TMG</h2>
                <p className="text-gray-300">
                  Punishers Germany<br />
                  [Name des Vertretungsberechtigten]<br />
                  [Straße und Hausnummer]<br />
                  [PLZ Ort]
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Kontakt</h2>
                <p className="text-gray-300">
                  Telefon: [Telefonnummer]<br />
                  E-Mail: <a href="mailto:info@punishers-germany.de" className="text-white hover:text-red-600 underline">info@punishers-germany.de</a>
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Vertreten durch</h2>
                <p className="text-gray-300">
                  [Name des Vertretungsberechtigten]
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Registereintrag</h2>
                <p className="text-gray-300">
                  Eintragung im Handelsregister.<br />
                  Registergericht: [Zuständiges Registergericht]<br />
                  Registernummer: [Registernummer]
                </p>
                <p className="text-gray-300 mt-4">
                  (Falls zutreffend, ansonsten diesen Abschnitt entfernen oder anpassen)
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Umsatzsteuer-ID</h2>
                <p className="text-gray-300">
                  Umsatzsteuer-Identifikationsnummer gemäß §27 a Umsatzsteuergesetz:<br />
                  [Ihre Umsatzsteuer-ID]
                </p>
                <p className="text-gray-300 mt-4">
                  (Falls zutreffend, ansonsten diesen Abschnitt entfernen oder anpassen)
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
                <p className="text-gray-300">
                  [Name des Verantwortlichen]<br />
                  [Adresse des Verantwortlichen]
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">Streitschlichtung</h2>
                <p className="text-gray-300">
                  Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-white hover:text-red-600 underline">https://ec.europa.eu/consumers/odr</a>.<br />
                  Unsere E-Mail-Adresse finden Sie oben im Impressum.
                </p>
                <p className="text-gray-300 mt-4">
                  Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

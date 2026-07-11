// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Datenschutzerklärung - Punishers Germany" },
//     { name: "description", content: "Datenschutzerklärung der Esport-Organisation Punishers Germany. Informationen zum Umgang mit persönlichen Daten." },
//   ];
// };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Privacy Policy */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Privacy+Policy+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4">Datenschutzerklärung</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              Informationen zum Schutz Ihrer persönlichen Daten auf unserer Website.
            </p>
          </div>
        </section>

        {/* Privacy Policy Details Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">1. Datenschutz auf einen Blick</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">Allgemeine Hinweise</h3>
                <p className="text-gray-300">
                  Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten passiert, wenn Sie unsere Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich identifiziert werden können. Ausführliche Informationen zum Thema Datenschutz entnehmen Sie unserer unter diesem Text aufgeführten Datenschutzerklärung.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold text-white mb-2">Datenerfassung auf unserer Website</h3>
                <p className="text-gray-300">
                  <strong>Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br />
                  Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten können Sie dem Impressum dieser Website entnehmen.
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>Wie erfassen wir Ihre Daten?</strong><br />
                  Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich z. B. um Daten handeln, die Sie in ein Kontaktformular eingeben.
                </p>
                <p className="text-gray-300 mt-4">
                  Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere IT-Systeme erfasst. Das sind vor allem technische Daten (z. B. Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs). Die Erfassung dieser Daten erfolgt automatisch, sobald Sie unsere Website betreten.
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>Wofür nutzen wir Ihre Daten?</strong><br />
                  Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten. Andere Daten können zur Analyse Ihres Nutzerverhaltens verwendet werden.
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>Welche Rechte haben Sie bezüglich Ihrer Daten?</strong><br />
                  Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck Ihrer gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht, die Berichtigung oder Löschung dieser Daten zu verlangen. Wenn Sie eine Einwilligung zur Datenverarbeitung erteilt haben, können Sie diese Einwilligung jederzeit für die Zukunft widerrufen. Außerdem haben Sie das Recht, unter bestimmten Umständen die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen. Des Weiteren steht Ihnen ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu.
                </p>
                <p className="text-gray-300 mt-4">
                  Hierzu sowie zu weiteren Fragen zum Thema Datenschutz können Sie sich jederzeit unter der im Impressum angegebenen Adresse an uns wenden.
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">2. Hosting und Content Delivery Networks (CDN)</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">Externes Hosting</h3>
                <p className="text-gray-300">
                  Diese Website wird bei einem externen Dienstleister gehostet (Hoster). Die personenbezogenen Daten, die auf dieser Website erfasst werden, werden auf den Servern des Hosters gespeichert. Hierbei kann es sich v. a. um IP-Adressen, Kontaktanfragen, Metadaten und Kommunikationsdaten, Vertragsdaten, Kontaktdaten, Namen, Websitezugriffe und sonstige Daten, die über eine Website generiert werden, handeln.
                </p>
                <p className="text-gray-300 mt-4">
                  Der Einsatz des Hosters erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und effizienten Bereitstellung unseres Online-Angebots durch einen professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO).
                </p>
                <p className="text-gray-300 mt-4">
                  Unser Hoster wird Ihre Daten nur insoweit verarbeiten, wie dies zur Erfüllung seiner Leistungspflichten erforderlich ist und unsere Weisungen bzgl. dieser Daten befolgen.
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">3. Allgemeine Hinweise und Pflichtinformationen</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">Datenschutz</h3>
                <p className="text-gray-300">
                  Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.
                </p>
                <p className="text-gray-300 mt-4">
                  Wenn Sie diese Website benutzen, werden verschiedene personenbezogene Daten erhoben. Personenbezogene Daten sind Daten, mit denen Sie persönlich identifiziert werden können. Die vorliegende Datenschutzerklärung erläutert, welche Daten wir erheben und wofür wir sie nutzen. Sie erläutert auch, wie und zu welchem Zweck dies geschieht.
                </p>
                <p className="text-gray-300 mt-4">
                  Wir weisen darauf hin, dass die Datenübertragung im Internet (z. B. bei der Kommunikation per E-Mail) Sicherheitslücken aufweisen kann. Ein lückenloser Schutz der Daten vor dem Zugriff durch Dritte ist nicht möglich.
                </p>
              </div>

              {/* Add more sections as needed for a complete privacy policy */}
              <p className="text-gray-400 mt-8 text-sm">
                (Dies ist ein Beispieltext für eine Datenschutzerklärung. Bitte konsultieren Sie einen Rechtsexperten, um eine für Ihre spezifische Situation gültige und vollständige Datenschutzerklärung zu erstellen.)
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

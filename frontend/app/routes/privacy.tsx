// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Datenschutzerklärung - Punishers Germany" },
//     { name: "description", content: "Datenschutzerklärung der Esport-Organisation Punishers Germany. Informationen zum Umgang mit persönlichen Daten." },
//   ];
// };

import { useTranslation } from "react-i18next";

export default function PrivacyPage() {
  const { t } = useTranslation("privacy");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Privacy Policy */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=Privacy+Policy+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Privacy Policy Details Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section1.heading")}</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">{t("section1.subheading1")}</h3>
                <p className="text-gray-300">
                  {t("section1.intro")}
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold text-white mb-2">{t("section1.subheading2")}</h3>
                <p className="text-gray-300">
                  <strong>{t("section1.q1_label")}</strong><br />
                  {t("section1.q1_text")}
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>{t("section1.q2_label")}</strong><br />
                  {t("section1.q2_text1")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section1.q2_text2")}
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>{t("section1.q3_label")}</strong><br />
                  {t("section1.q3_text")}
                </p>
                <p className="text-gray-300 mt-4">
                  <strong>{t("section1.q4_label")}</strong><br />
                  {t("section1.q4_text")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section1.closing")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section2.heading")}</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">{t("section2.subheading1")}</h3>
                <p className="text-gray-300">
                  {t("section2.text1")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section2.text2")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section2.text3")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section3.heading")}</h2>
                <h3 className="text-2xl font-semibold text-white mb-2">{t("section3.subheading1")}</h3>
                <p className="text-gray-300">
                  {t("section3.text1")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section3.text2")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section3.text3")}
                </p>
              </div>

              {/* Add more sections as needed for a complete privacy policy */}
              <p className="text-gray-400 mt-8 text-sm">
                {t("disclaimer")}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

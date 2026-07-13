// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Impressum - Punishers Germany" },
//     { name: "description", content: "Impressum der Esport-Organisation Punishers Germany. Rechtliche Angaben und Kontaktinformationen." },
//   ];
// };

import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchPageBackground } from "~/lib/siteSettings";

export const loader: LoaderFunction = async () => {
  const backgroundUrl = await fetchPageBackground("imprint");
  return { backgroundUrl };
};

export default function ImprintPage() {
  const { backgroundUrl } = useLoaderData() as { backgroundUrl: string | null };
  const { t } = useTranslation("imprint");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Imprint */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: `url('${backgroundUrl || "https://via.placeholder.com/1920x400?text=Impressum+Banner"}')` }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Imprint Details Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section1.heading")}</h2>
                <p className="text-gray-300">
                  {t("section1.line1")}<br />
                  {t("section1.line2")}<br />
                  {t("section1.line3")}<br />
                  {t("section1.line4")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section2.heading")}</h2>
                <p className="text-gray-300">
                  {t("section2.phone_label")}<br />
                  {t("section2.email_label")} <a href="mailto:info@punishers-germany.de" className="text-white hover:text-red-600 underline">info@punishers-germany.de</a>
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section3.heading")}</h2>
                <p className="text-gray-300">
                  {t("section3.body")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section4.heading")}</h2>
                <p className="text-gray-300">
                  {t("section4.line1")}<br />
                  {t("section4.line2")}<br />
                  {t("section4.line3")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section4.note")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section5.heading")}</h2>
                <p className="text-gray-300">
                  {t("section5.line1")}<br />
                  {t("section5.line2")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section5.note")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section6.heading")}</h2>
                <p className="text-gray-300">
                  {t("section6.line1")}<br />
                  {t("section6.line2")}
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-red-600 mb-4">{t("section7.heading")}</h2>
                <p className="text-gray-300">
                  {t("section7.body_prefix")} <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-white hover:text-red-600 underline">https://ec.europa.eu/consumers/odr</a>.<br />
                  {t("section7.body_suffix")}
                </p>
                <p className="text-gray-300 mt-4">
                  {t("section7.note")}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

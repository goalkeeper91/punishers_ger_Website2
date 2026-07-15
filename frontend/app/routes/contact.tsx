// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Kontakt - Punishers Germany" },
//     { name: "description", content: "Kontaktiere Punishers Germany für Anfragen, Partnerschaften oder allgemeine Informationen. Wir freuen uns auf deine Nachricht!" },
//   ];
// };

import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchPageBackground } from "~/lib/siteSettings";
import { fetchDiscordInviteUrl } from "~/lib/publicContent";

export const loader: LoaderFunction = async () => {
  const [backgroundUrl, discordUrl] = await Promise.all([
    fetchPageBackground("contact"),
    fetchDiscordInviteUrl(),
  ]);
  return { backgroundUrl, discordUrl };
};

export default function ContactPage() {
  const { backgroundUrl, discordUrl } = useLoaderData() as { backgroundUrl: string | null; discordUrl: string | null };
  const { t } = useTranslation("contact");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for Contact */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: `url('${backgroundUrl || "https://via.placeholder.com/1920x400?text=Contact+Us+Banner"}')` }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Contact Form Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl font-bold text-white text-center mb-12">{t("form.heading")}</h2>
            <div className="max-w-2xl mx-auto bg-gray-800 p-8 rounded-lg shadow-xl">
              <form className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-lg font-medium text-gray-300 mb-2">{t("form.name_label")}</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder={t("form.name_placeholder") ?? undefined}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-lg font-medium text-gray-300 mb-2">{t("form.email_label")}</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder={t("form.email_placeholder") ?? undefined}
                  />
                </div>
                <div>
                  <label htmlFor="subject" className="block text-lg font-medium text-gray-300 mb-2">{t("form.subject_label")}</label>
                  <input
                    type="text"
                    id="subject"
                    name="subject"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder={t("form.subject_placeholder") ?? undefined}
                  />
                </div>
                <div>
                  <label htmlFor="message" className="block text-lg font-medium text-gray-300 mb-2">{t("form.message_label")}</label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                    placeholder={t("form.message_placeholder") ?? undefined}
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg"
                >
                  {t("form.submit")}
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Contact Information Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("info.heading")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl">
                <h3 className="text-2xl font-bold text-red-600 mb-3">{t("info.email_title")}</h3>
                <p className="text-gray-300 text-lg">{t("info.email_description")}</p>
                <a href="mailto:info@punishersgermany.de" className="text-white hover:text-red-600 underline">info@punishersgermany.de</a>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl">
                <h3 className="text-2xl font-bold text-red-600 mb-3">{t("info.social_title")}</h3>
                <p className="text-gray-300 text-lg">{t("info.social_description")}</p>
                <div className="flex justify-center space-x-4 mt-3">
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 text-2xl"><i className="fab fa-twitter"></i></a> {/* Placeholder for icon */}
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 text-2xl"><i className="fab fa-instagram"></i></a> {/* Placeholder for icon */}
                  {discordUrl && (
                    <a href={discordUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600 text-2xl"><i className="fab fa-discord"></i></a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

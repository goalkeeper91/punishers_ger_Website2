// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Über uns - Punishers Germany" },
//     { name: "description", content: "Erfahre mehr über Punishers Germany: Unsere Mission, Werte und die Geschichte hinter unserer Esport-Organisation." },
//   ];
// };

import { useTranslation } from "react-i18next";

export default function AboutUsPage() {
  const { t } = useTranslation("about_us");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for About Us */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=About+Us+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Mission & Vision Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("mission_vision.heading")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-12">
              <div className="text-left bg-gray-800 p-8 rounded-lg shadow-xl">
                <h3 className="text-3xl font-bold text-red-600 mb-4">{t("mission_vision.mission_title")}</h3>
                <p className="text-gray-300 leading-relaxed">
                  {t("mission_vision.mission_text")}
                </p>
              </div>
              <div className="text-left bg-gray-800 p-8 rounded-lg shadow-xl">
                <h3 className="text-3xl font-bold text-red-600 mb-4">{t("mission_vision.vision_title")}</h3>
                <p className="text-gray-300 leading-relaxed">
                  {t("mission_vision.vision_text")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Our Story Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("story.heading")}</h2>
            <div className="max-w-3xl mx-auto text-left bg-gray-800 p-8 rounded-lg shadow-xl">
              <p className="text-gray-300 leading-relaxed mb-4">
                {t("story.paragraph1")}
              </p>
              <p className="text-gray-300 leading-relaxed">
                {t("story.paragraph2")}
              </p>
            </div>
          </div>
        </section>

        {/* Our Values Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-6">{t("values.heading")}</h2>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              {t("values.description")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">🏆</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">{t("values.excellence_title")}</h3>
                <p className="text-gray-300">{t("values.excellence_text")}</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">🤝</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">{t("values.community_title")}</h3>
                <p className="text-gray-300">{t("values.community_text")}</p>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg shadow-xl flex flex-col items-center">
                <div className="text-red-600 text-5xl mb-4">💡</div> {/* Placeholder icon */}
                <h3 className="text-2xl font-bold text-white mb-2">{t("values.innovation_title")}</h3>
                <p className="text-gray-300">{t("values.innovation_text")}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

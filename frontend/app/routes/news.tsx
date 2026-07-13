import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";
import { stripMarkdown } from "~/lib/markdown";
import { getLanguageFromCookieHeader } from "~/i18n/config";

// import type { MetaFunction } from "@react-router/node"; // Removed Remix-specific MetaFunction

// export const meta: MetaFunction = () => {
//   return [
//     { title: "News - Punishers Germany" },
//     { name: "description", content: "Bleibe auf dem Laufenden mit den neuesten Nachrichten, Ankündigungen und Updates von Punishers Germany." },
//   ];
// };

interface NewsArticle {
  id: number;
  title: string;
  slug: string;
  content: string;
  author_name: string | null;
  image_url: string | null;
  published_date: string;
  updated_date: string;
  status: string;
  original_language: string;
  is_machine_translated: boolean;
}

// News content follows the site's own language switch automatically - the
// backend auto-translates articles (news/translation.py) and returns
// whichever language ?lang= asks for, falling back to the original if no
// translation exists yet.
export const loader: LoaderFunction = async ({ request }) => {
  const language = getLanguageFromCookieHeader(request.headers.get("Cookie"));
  try {
    // Fetch data from your FastAPI backend
    const response = await fetch(`${API_BASE_URL}/news/?lang=${language}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const newsArticles: NewsArticle[] = await response.json();

    // For simplicity, let's just return all articles for now.
    // You can later implement logic to separate latest news from archive.
    return { newsArticles };
  } catch (error) {
    console.error("Failed to fetch news articles:", error);
    // Return an empty array if fetching fails
    return { newsArticles: [] };
  }
};

export default function NewsPage() {
  const { newsArticles } = useLoaderData() as { newsArticles: NewsArticle[] }; // Type assertion for useLoaderData
  const { t, i18n } = useTranslation("news");

  // Simple logic to separate latest news (e.g., first 2) and archive
  const latestNews = newsArticles.slice(0, 2);
  const newsArchive = newsArticles.slice(2);

  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(i18n.language === "en" ? "en-US" : "de-DE", options);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        {/* Hero Section for News */}
        <section className="relative py-20 md:py-32 bg-cover bg-center text-center" style={{ backgroundImage: "url('https://via.placeholder.com/1920x400?text=News+Banner')" }}>
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-4 break-words">{t("hero.title")}</h1>
            <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
              {t("hero.description")}
            </p>
          </div>
        </section>

        {/* Latest News Section */}
        <section className="py-16 md:py-24 bg-gray-900">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-12">{t("latest.heading")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {latestNews.map((article) => (
                <div key={article.id} className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                  <img src={article.image_url || imageFallback("https://via.placeholder.com/600x400?text=No+Image")} alt={article.title} className="w-full h-64 object-cover" />
                  <div className="p-6 text-left">
                    <p className="text-sm text-gray-400 mb-2">{formatDate(article.published_date)}</p>
                    <h3 className="text-2xl font-bold text-white mb-3">{article.title}</h3>
                    <p className="text-gray-300 mb-4">{stripMarkdown(article.content).substring(0, 150)}...</p> {/* Display excerpt */}
                    <a href={`/news/${article.slug}`} className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
                      {t("latest.read_more")}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* News Archive Section */}
        <section className="py-16 md:py-24 bg-gray-950">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-white mb-12">{t("archive.heading")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {newsArchive.map((article) => (
                <div key={article.id} className="bg-gray-800 rounded-lg shadow-xl overflow-hidden transform hover:scale-105 transition-transform duration-300">
                  <img src={article.image_url || imageFallback("https://via.placeholder.com/300x200?text=No+Image")} alt={article.title} className="w-full h-48 object-cover" />
                  <div className="p-4 text-left">
                    <p className="text-sm text-gray-400 mb-1">{formatDate(article.published_date)}</p>
                    <h3 className="text-xl font-bold text-white mb-3">{article.title}</h3>
                    <a href={`/news/${article.slug}`} className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-4 rounded-full text-xs transition-colors duration-300">
                      {t("archive.details")}
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-12">
              <a href="#" className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg transition-colors duration-300 shadow-lg">
                {t("archive.older_news")}
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
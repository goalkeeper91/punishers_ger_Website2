import type { LoaderFunction } from "react-router";
import { useLoaderData } from "react-router";
import ReactMarkdown from "react-markdown";
import { API_BASE_URL } from "~/lib/config";
import { imageFallback } from "~/lib/sampleAssets";

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
}

export const loader: LoaderFunction = async ({ params }) => {
  const response = await fetch(`${API_BASE_URL}/news/${params.slug}/`);
  if (!response.ok) {
    throw new Response("Artikel nicht gefunden", { status: response.status === 404 ? 404 : 500 });
  }
  const article: NewsArticle = await response.json();
  return { article };
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });
}

export default function NewsDetailPage() {
  const { article } = useLoaderData() as { article: NewsArticle };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <main>
        <section
          className="relative py-20 md:py-32 bg-cover bg-center text-center"
          style={{ backgroundImage: `url('${article.image_url || imageFallback("https://via.placeholder.com/1920x400?text=News")}')` }}
        >
          <div className="absolute inset-0 bg-black opacity-70"></div>
          <div className="relative z-10 container mx-auto px-4">
            <p className="text-sm text-gray-300 mb-3">
              {formatDate(article.published_date)}
              {article.author_name && ` · ${article.author_name}`}
            </p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-white max-w-3xl mx-auto">{article.title}</h1>
          </div>
        </section>

        <article className="py-16 md:py-20 bg-gray-900">
          <div className="container mx-auto px-4 max-w-3xl">
            <ReactMarkdown
              components={{
                h1: (props) => <h2 className="text-3xl font-bold text-white mt-8 mb-4 first:mt-0" {...props} />,
                h2: (props) => <h2 className="text-2xl font-bold text-white mt-8 mb-4 first:mt-0" {...props} />,
                h3: (props) => <h3 className="text-xl font-bold text-white mt-6 mb-3" {...props} />,
                p: (props) => <p className="text-gray-300 mb-4 leading-relaxed" {...props} />,
                a: (props) => (
                  <a className="text-red-500 hover:text-red-400 underline" target="_blank" rel="noopener noreferrer" {...props} />
                ),
                ul: (props) => <ul className="list-disc list-inside text-gray-300 mb-4 space-y-1" {...props} />,
                ol: (props) => <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-1" {...props} />,
                blockquote: (props) => (
                  <blockquote className="border-l-4 border-red-600 pl-4 italic text-gray-400 my-4" {...props} />
                ),
                strong: (props) => <strong className="font-bold text-white" {...props} />,
                em: (props) => <em className="italic" {...props} />,
                code: (props) => <code className="bg-gray-800 px-1.5 py-0.5 rounded text-red-400 text-sm" {...props} />,
              }}
            >
              {article.content}
            </ReactMarkdown>

            <a href="/news" className="inline-block mt-8 text-red-500 hover:text-red-400 transition-colors duration-300">
              ← Zurück zu News
            </a>
          </div>
        </article>
      </main>
    </div>
  );
}

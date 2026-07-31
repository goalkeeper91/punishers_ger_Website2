// Resource route (no default export) - serves GET /sitemap.xml. Includes
// the static public pages plus, best-effort, every published news article
// and team (same list endpoints news.tsx/teams.tsx already use) - if the
// backend is unreachable this still returns the static URLs rather than
// failing the whole sitemap.
import { API_BASE_URL } from "~/lib/config";
import { SITE_URL } from "~/lib/seo";

interface StaticRoute {
  path: string;
  changefreq: string;
  priority: string;
}

const staticRoutes: StaticRoute[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/news", changefreq: "daily", priority: "0.8" },
  { path: "/teams", changefreq: "weekly", priority: "0.8" },
  { path: "/creators", changefreq: "monthly", priority: "0.6" },
  { path: "/join-us", changefreq: "monthly", priority: "0.7" },
  { path: "/sponsors", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
  { path: "/about-us", changefreq: "monthly", priority: "0.6" },
  { path: "/imprint", changefreq: "yearly", priority: "0.2" },
  { path: "/privacy", changefreq: "yearly", priority: "0.2" },
];

function urlEntry(path: string, changefreq: string, priority: string): string {
  return `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

export async function loader() {
  const entries = staticRoutes.map((r) => urlEntry(r.path, r.changefreq, r.priority));

  try {
    const newsResponse = await fetch(`${API_BASE_URL}/news/`);
    if (newsResponse.ok) {
      const articles: { slug: string }[] = await newsResponse.json();
      for (const article of articles) {
        entries.push(urlEntry(`/news/${article.slug}`, "monthly", "0.6"));
      }
    }
  } catch (error) {
    console.error("sitemap.xml: failed to fetch news articles", error);
  }

  try {
    const teamsResponse = await fetch(`${API_BASE_URL}/teams/`);
    if (teamsResponse.ok) {
      const teams: { id: number }[] = await teamsResponse.json();
      for (const team of teams) {
        entries.push(urlEntry(`/teams/${team.id}`, "weekly", "0.5"));
      }
    }
  } catch (error) {
    console.error("sitemap.xml: failed to fetch teams", error);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

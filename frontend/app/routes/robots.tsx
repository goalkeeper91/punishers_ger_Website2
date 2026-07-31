// Resource route (no default export) - React Router serves whatever the
// loader returns, so this responds to GET /robots.txt with plain text.
import { SITE_URL } from "~/lib/seo";

export async function loader() {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /profile
Disallow: /stats
Disallow: /praccs
Disallow: /util-training
Disallow: /login
Disallow: /register
Disallow: /register-success
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: ${SITE_URL}/sitemap.xml
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

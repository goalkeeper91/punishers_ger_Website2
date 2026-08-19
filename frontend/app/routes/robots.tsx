// Resource route (no default export) - React Router serves whatever the
// loader returns, so this responds to GET /robots.txt with plain text.
import { SITE_URL } from "~/lib/seo";

export async function loader() {
  // /profile (bare) is the logged-in user's own edit form - private. But
  // /profile/:username (routes/profile.$username.tsx) is a public profile
  // page, so it needs its own Allow: the longer/more specific rule wins
  // over the shorter Disallow for crawlers that support this (Google, Bing).
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /profile
Allow: /profile/
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

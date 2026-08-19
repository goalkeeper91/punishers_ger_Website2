// Shared meta-descriptor builder for React Router v7's native meta() export.
// Every public route calls this so title/description/canonical/OG/Twitter
// tags are consistent and never duplicated with a root-level fallback (root
// itself deliberately never sets a title/description - see root.tsx's meta
// export, which only carries the site-wide JSON-LD).

export const SITE_URL = "https://punishersgermany.de";
export const SITE_NAME = "Punishers Germany";
export const DEFAULT_IMAGE = `${SITE_URL}/PUNISHERS_LOGO.png`;

interface BuildMetaOptions {
  title: string;
  description: string;
  path: string;
  image?: string;
  noindex?: boolean;
  /** Use `title` verbatim as the <title> instead of appending " - Punishers
   * Germany" - only the homepage wants the bare brand name as its title. */
  brandTitle?: boolean;
  /** "article" switches og:type and adds the Open Graph article: properties
   * below - used by news.$slug.tsx. Everything else stays "website". */
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
}

// React Router's meta() return type - kept loose here since the exact
// MetaDescriptor union isn't exported for reuse across route modules.
type MetaDescriptor = Record<string, unknown>;

export function buildMeta({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  noindex = false,
  brandTitle = false,
  type = "website",
  publishedTime,
  modifiedTime,
  author,
}: BuildMetaOptions): MetaDescriptor[] {
  const url = `${SITE_URL}${path}`;
  const fullTitle = brandTitle ? title : `${title} - ${SITE_NAME}`;

  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },

    { property: "og:type", content: type },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { property: "og:locale", content: "de_DE" },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];

  if (type === "article") {
    if (publishedTime) tags.push({ property: "article:published_time", content: publishedTime });
    if (modifiedTime) tags.push({ property: "article:modified_time", content: modifiedTime });
    if (author) tags.push({ property: "article:author", content: author });
  }

  if (noindex) {
    tags.push({ name: "robots", content: "noindex, nofollow" });
  }

  return tags;
}

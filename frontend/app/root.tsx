import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useNavigate, // Import useNavigate for logout redirect
  useLocation, // Import useLocation
  useRevalidator,
} from "react-router";
import type { LoaderFunction } from "react-router"; // Import LoaderFunction type
import { useState, useEffect, useRef } from "react"; // Import useState and useEffect
import { I18nextProvider, useTranslation } from "react-i18next";

import type { Route } from "./+types/root";
import "./app.css";
import { authFetch, isLoggedIn, clearTokens, type AuthUser } from "~/lib/auth";
import { getAdminNavItems } from "~/lib/adminNav";
import {
  fetchActiveSponsors,
  fetchActiveSocialLinks,
  trackSponsorClick,
  trackSocialClick,
  PLATFORM_LABELS,
  type Sponsor,
  type SocialLink,
} from "~/lib/publicContent";
import {
  createI18nInstance,
  getLanguageFromCookieHeader,
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_NAME,
  type SupportedLanguage,
} from "~/i18n/config";

type UserProfile = AuthUser;

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  // Favicon links
  { rel: "apple-touch-icon", sizes: "180x180", href: "/favicons/apple-touch-icon.png" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicons/favicon-32x32.png" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicons/favicon-16x16.png" },
  { rel: "manifest", href: "/favicons/site.webmanifest" },
  { rel: "mask-icon", href: "/favicons/safari-pinned-tab.svg", color: "#5bbad5" },
  { rel: "shortcut icon", href: "/favicons/favicon.ico" },
];

// --- ROOT LOADER FUNCTION ---
// This loader runs on the server (for SSR) and on the client. It cannot
// access localStorage (so the logged-in user is fetched client-side below),
// but sponsors/socials are public data and safe to fetch here for SSR. The
// UI language is read from a cookie here too (not localStorage), since the
// initial server-rendered HTML needs to already be in the right language -
// see app/i18n/config.ts.
export const loader: LoaderFunction = async ({ request }) => {
  const [sponsors, socialLinks] = await Promise.all([
    fetchActiveSponsors(),
    fetchActiveSocialLinks(),
  ]);
  const language = getLanguageFromCookieHeader(request.headers.get("Cookie"));
  return { user: null, sponsors, socialLinks, language };
};

export function Layout({ children }: { children: React.ReactNode }) {
  // useLoaderData() returns undefined here when a URL matches no route at
  // all (React Router renders the root Layout around the 404 ErrorBoundary
  // without running any loaders) - fall back to empty defaults so the 404
  // page can render instead of this crashing first.
  const data = useLoaderData() as
    | { user: UserProfile | null; sponsors: Sponsor[]; socialLinks: SocialLink[]; language: SupportedLanguage }
    | undefined;
  const { user: initialUser = null, sponsors = [], socialLinks = [], language = DEFAULT_LANGUAGE } = data ?? {};
  const [loggedInUser, setLoggedInUser] = useState<UserProfile | null>(initialUser);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLLIElement>(null);
  const navigate = useNavigate();
  const location = useLocation(); // Initialize useLocation
  const revalidator = useRevalidator();

  // One i18next instance per Layout mount (not per render/navigation - the
  // root Layout stays mounted across client-side route changes). When the
  // loader hands back a new `language` after the switcher revalidates, sync
  // the existing instance instead of creating a new one.
  const [i18nInstance] = useState(() => createI18nInstance(language));
  useEffect(() => {
    i18nInstance.changeLanguage(language);
  }, [i18nInstance, language]);

  const changeLanguage = (lang: SupportedLanguage) => {
    document.cookie = `${LANGUAGE_COOKIE_NAME}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
    revalidator.revalidate();
  };

  // Close the mobile menu / user dropdown whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Close the user dropdown on an outside click.
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  // Client-side effect to fetch user data after hydration. Auth state lives
  // in localStorage (via app/lib/auth.ts), which isn't available during SSR,
  // so this always runs client-side and re-checks whenever the route changes.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const fetchUser = async () => {
      if (!isLoggedIn()) {
        setLoggedInUser(null);
        return;
      }
      try {
        const response = await authFetch("/users/me/");
        if (response.ok) {
          const userData: UserProfile = await response.json();
          setLoggedInUser(userData);
        } else {
          clearTokens();
          setLoggedInUser(null);
        }
      } catch (error) {
        console.error("Failed to fetch current user:", error);
        setLoggedInUser(null);
      }
    };

    fetchUser();
  }, [location.pathname]); // Re-run when the path changes

  const handleLogout = () => {
    clearTokens();
    setLoggedInUser(null);
    navigate("/"); // Redirect to home page after logout
  };

  // Same role-aware list AdminNav.tsx and the Profile sidebar use, so
  // Verwaltungsrouten are reachable from every page, not just /profile.
  const adminNavItems = getAdminNavItems(loggedInUser);

  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-gray-950 text-gray-100 font-sans">
        <I18nextProvider i18n={i18nInstance}>
          <SiteChrome
            sponsors={sponsors}
            socialLinks={socialLinks}
            loggedInUser={loggedInUser}
            mobileMenuOpen={mobileMenuOpen}
            setMobileMenuOpen={setMobileMenuOpen}
            userMenuOpen={userMenuOpen}
            setUserMenuOpen={setUserMenuOpen}
            userMenuRef={userMenuRef}
            adminNavItems={adminNavItems}
            handleLogout={handleLogout}
            language={language}
            changeLanguage={changeLanguage}
          >
            {children}
          </SiteChrome>
        </I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

interface SiteChromeProps {
  children: React.ReactNode;
  sponsors: Sponsor[];
  socialLinks: SocialLink[];
  loggedInUser: UserProfile | null;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (updater: (open: boolean) => boolean) => void;
  userMenuOpen: boolean;
  setUserMenuOpen: (updater: (open: boolean) => boolean) => void;
  userMenuRef: React.RefObject<HTMLLIElement | null>;
  adminNavItems: ReturnType<typeof getAdminNavItems>;
  handleLogout: () => void;
  language: SupportedLanguage;
  changeLanguage: (lang: SupportedLanguage) => void;
}

/** Everything inside <body> that needs translations (header/nav, footer) -
 * split out from Layout so it renders as a child of I18nextProvider (a hook
 * like useTranslation() can't see a context provider rendered by the same
 * component instance that calls the hook). */
function SiteChrome({
  children,
  sponsors,
  socialLinks,
  loggedInUser,
  mobileMenuOpen,
  setMobileMenuOpen,
  userMenuOpen,
  setUserMenuOpen,
  userMenuRef,
  adminNavItems,
  handleLogout,
  language,
  changeLanguage,
}: SiteChromeProps) {
  const { t } = useTranslation("common");

  const navLinks = [
    { href: "/", label: t("nav.home") },
    { href: "/news", label: t("nav.news") },
    { href: "/teams", label: t("nav.teams") },
    { href: "/creators", label: t("nav.creators") },
    { href: "/join-us", label: t("nav.join_us") },
    { href: "/sponsors", label: t("nav.partners") },
    { href: "/contact", label: t("nav.contact") },
  ];

  const languageSwitcher = (
    <div className="flex items-center gap-1 text-xs font-semibold">
      <button
        onClick={() => changeLanguage("de")}
        aria-pressed={language === "de"}
        className={`px-2 py-1 rounded ${language === "de" ? "bg-red-600 text-white" : "text-gray-400 hover:text-white"}`}
      >
        {t("language_switcher.german")}
      </button>
      <span className="text-gray-600">/</span>
      <button
        onClick={() => changeLanguage("en")}
        aria-pressed={language === "en"}
        className={`px-2 py-1 rounded ${language === "en" ? "bg-red-600 text-white" : "text-gray-400 hover:text-white"}`}
      >
        {t("language_switcher.english")}
      </button>
    </div>
  );

  return (
    <>
      {/* Global Header */}
      <header className="bg-gray-900 shadow-lg sticky top-0 z-50 relative">
        <nav className="container mx-auto px-4 h-[72px] flex justify-between items-center">
          <a href="/" className="flex items-center space-x-2 min-w-0">
            <img src="/PUNISHERS_LOGO.png" alt="Punishers Germany Logo" className="h-10 flex-shrink-0" />
            <span className="text-xl md:text-2xl font-bold text-white truncate hidden sm:inline">Punishers Germany</span>
          </a>
          <ul className="hidden lg:flex space-x-6 items-center">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-gray-300 hover:text-red-600 transition-colors duration-300">
                  {link.label}
                </a>
              </li>
            ))}
            <li>{languageSwitcher}</li>

            {loggedInUser ? (
              <li className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((open) => !open)}
                  className="flex items-center space-x-2 text-gray-300 hover:text-red-600 transition-colors duration-300 cursor-pointer"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                >
                  {loggedInUser.profile_picture_url ? (
                    <img
                      src={loggedInUser.profile_picture_url}
                      alt="Profile"
                      className="h-8 w-8 rounded-full object-cover border border-gray-600"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center text-sm font-semibold">
                      {loggedInUser.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span>{loggedInUser.username}</span>
                  <svg className={`w-4 h-4 transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-md shadow-xl py-2 z-50">
                    <a href="/profile" className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200">
                      {t("user_menu.my_profile")}
                    </a>
                    <a href="/stats" className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200">
                      {t("user_menu.stats")}
                    </a>
                    {adminNavItems.length > 0 && (
                      <>
                        <div className="border-t border-gray-700 my-1" />
                        <p className="px-4 pt-1 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {t("user_menu.management")}
                        </p>
                        {adminNavItems.map((item) => (
                          <a
                            key={item.key}
                            href={item.href}
                            className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
                          >
                            {item.label}
                          </a>
                        ))}
                      </>
                    )}
                    <div className="border-t border-gray-700 my-1" />
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200 cursor-pointer"
                    >
                      {t("user_menu.logout")}
                    </button>
                  </div>
                )}
              </li>
            ) : (
              <li>
                <a href="/login" className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-full text-sm transition-colors duration-300">
                  {t("nav.login")}
                </a>
              </li>
            )}
          </ul>
          {/* Mobile menu toggle */}
          <div className="lg:hidden flex items-center gap-2">
            {languageSwitcher}
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="text-gray-300 hover:text-red-600 focus:outline-none p-2 -mr-2"
              aria-label={mobileMenuOpen ? t("nav.close_menu") : t("nav.open_menu")}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
              )}
            </button>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 w-full bg-gray-900 border-t border-gray-800 shadow-lg z-50">
            <ul className="flex flex-col px-4 py-4 space-y-1">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="block py-2 text-gray-300 hover:text-red-600 transition-colors duration-300">
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="border-t border-gray-800 pt-3 mt-2">
                {loggedInUser ? (
                  <div className="space-y-1">
                    <a href="/profile" className="flex items-center space-x-2 py-2 text-gray-300 hover:text-red-600 transition-colors duration-300">
                      {loggedInUser.profile_picture_url ? (
                        <img src={loggedInUser.profile_picture_url} alt="Profile" className="h-8 w-8 rounded-full object-cover border border-gray-600" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center text-sm font-semibold">
                          {loggedInUser.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span>{loggedInUser.username}</span>
                    </a>
                    <a href="/stats" className="block py-2 pl-10 text-gray-300 hover:text-red-600 transition-colors duration-300">
                      {t("user_menu.stats")}
                    </a>
                    {adminNavItems.length > 0 && (
                      <div className="pl-10 space-y-1">
                        <p className="pt-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {t("user_menu.management")}
                        </p>
                        {adminNavItems.map((item) => (
                          <a
                            key={item.key}
                            href={item.href}
                            className="block py-1.5 text-gray-300 hover:text-red-600 transition-colors duration-300"
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
                    )}
                    <button onClick={handleLogout} className="block w-full text-left py-2 pl-10 text-gray-300 hover:text-red-600 transition-colors duration-300 cursor-pointer">
                      {t("user_menu.logout")}
                    </button>
                  </div>
                ) : (
                  <a href="/login" className="block text-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-full text-sm transition-colors duration-300">
                    {t("nav.login")}
                  </a>
                )}
              </li>
            </ul>
          </div>
        )}
      </header>

      {/* Scrolling Sponsor Banner */}
      {sponsors.length > 0 && (
        <div className="w-full bg-gray-800 py-2 overflow-hidden">
          <div className="flex scroll-container animate-scroll-left">
            {/* Duplicate logos for seamless loop */}
            {sponsors.concat(sponsors).map((sponsor, index) => {
              const logo = (
                <img
                  src={sponsor.logo_url || "https://via.placeholder.com/120x60?text=" + encodeURIComponent(sponsor.name)}
                  alt={sponsor.name}
                  className="h-8 object-contain"
                />
              );
              return (
                <div key={`${sponsor.id}-${index}`} className="flex-shrink-0 mx-4">
                  {sponsor.website_url ? (
                    <a
                      href={sponsor.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackSponsorClick(sponsor.id)}
                    >
                      {logo}
                    </a>
                  ) : (
                    logo
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {children}

      {/* Global Footer */}
      <footer className="bg-gray-900 py-12 border-t border-gray-800">
        <div className="container mx-auto px-4 text-center md:text-left">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="flex flex-col items-center md:items-start">
              <img src="/PUNISHERS_LOGO.png" alt="Punishers Germany Logo" className="h-12 mb-4" />
              <p className="text-gray-400">{t("footer.tagline")}</p>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">{t("footer.nav_heading")}</h3>
              <ul className="space-y-2">
                {navLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-gray-400 hover:text-red-600 transition-colors duration-300">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">{t("footer.follow_us_heading")}</h3>
              <ul className="space-y-2">
                {socialLinks.length === 0 && (
                  <li className="text-gray-500 text-sm">{t("footer.no_social_links")}</li>
                )}
                {socialLinks.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackSocialClick(link.id)}
                      className="text-gray-400 hover:text-red-600 transition-colors duration-300"
                    >
                      {PLATFORM_LABELS[link.platform] || link.platform}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-4">{t("footer.legal_heading")}</h3>
              <ul className="space-y-2">
                <li><a href="/imprint" className="text-gray-400 hover:text-red-600 transition-colors duration-300">{t("footer.imprint")}</a></li>
                <li><a href="/privacy" className="text-gray-400 hover:text-red-600 transition-colors duration-300">{t("footer.privacy")}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-500">{t("footer.copyright", { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </footer>
    </>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}

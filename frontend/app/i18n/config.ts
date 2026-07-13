// Central i18next registry. Every locale JSON file (one pair per page/area,
// so parallel translation work never touches the same file) is imported and
// registered here - components just call useTranslation("<namespace>").
//
// A fresh i18next instance is created per call to createI18nInstance()
// rather than sharing one global instance, because this app is server-side
// rendered (react-router.config.ts has ssr: true): a single shared instance
// would let concurrent requests for different users/languages clobber each
// other's active language on the server. The browser creates exactly one
// instance at hydration and keeps it for the session (see root.tsx).

import i18n, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import commonDe from "./locales/de/common.json";
import commonEn from "./locales/en/common.json";
import homeDe from "./locales/de/home.json";
import homeEn from "./locales/en/home.json";
import newsDe from "./locales/de/news.json";
import newsEn from "./locales/en/news.json";
import teamsDe from "./locales/de/teams.json";
import teamsEn from "./locales/en/teams.json";
import creatorsDe from "./locales/de/creators.json";
import creatorsEn from "./locales/en/creators.json";
import joinUsDe from "./locales/de/join_us.json";
import joinUsEn from "./locales/en/join_us.json";
import contactDe from "./locales/de/contact.json";
import contactEn from "./locales/en/contact.json";
import sponsorsDe from "./locales/de/sponsors.json";
import sponsorsEn from "./locales/en/sponsors.json";
import aboutUsDe from "./locales/de/about_us.json";
import aboutUsEn from "./locales/en/about_us.json";
import imprintDe from "./locales/de/imprint.json";
import imprintEn from "./locales/en/imprint.json";
import privacyDe from "./locales/de/privacy.json";
import privacyEn from "./locales/en/privacy.json";
import authDe from "./locales/de/auth.json";
import authEn from "./locales/en/auth.json";
import profileDe from "./locales/de/profile.json";
import profileEn from "./locales/en/profile.json";
import statsDe from "./locales/de/stats.json";
import statsEn from "./locales/en/stats.json";

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "de";
export const LANGUAGE_COOKIE_NAME = "lang";

const resources = {
  de: {
    common: commonDe,
    home: homeDe,
    news: newsDe,
    teams: teamsDe,
    creators: creatorsDe,
    join_us: joinUsDe,
    contact: contactDe,
    sponsors: sponsorsDe,
    about_us: aboutUsDe,
    imprint: imprintDe,
    privacy: privacyDe,
    auth: authDe,
    profile: profileDe,
    stats: statsDe,
  },
  en: {
    common: commonEn,
    home: homeEn,
    news: newsEn,
    teams: teamsEn,
    creators: creatorsEn,
    join_us: joinUsEn,
    contact: contactEn,
    sponsors: sponsorsEn,
    about_us: aboutUsEn,
    imprint: imprintEn,
    privacy: privacyEn,
    auth: authEn,
    profile: profileEn,
    stats: statsEn,
  },
};

export function isSupportedLanguage(value: string | null | undefined): value is SupportedLanguage {
  return !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Parses the raw `Cookie` request header for `lang=de|en` - used server-side
 * (root.tsx loader), where document.cookie isn't available. Defaults to
 * DEFAULT_LANGUAGE (German - matches all existing content) if absent/invalid,
 * deliberately without any Accept-Language sniffing. */
export function getLanguageFromCookieHeader(cookieHeader: string | null | undefined): SupportedLanguage {
  if (!cookieHeader) return DEFAULT_LANGUAGE;
  const match = cookieHeader.match(/(?:^|;\s*)lang=([^;]+)/);
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function createI18nInstance(language: SupportedLanguage): I18nInstance {
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    resources,
    defaultNS: "common",
    interpolation: { escapeValue: false }, // React already escapes JSX values
    react: { useSuspense: false },
  });
  return instance;
}

// A single shared instance for translating strings *outside* React render -
// form-validation errors built in a route's `action`/`clientAction`, which
// run before any component (and thus any hook) exists. Safe to share across
// concurrent SSR requests unlike createI18nInstance()'s instances, because
// callers always pass an explicit `{ lng }` per call instead of relying on
// (and mutating) the instance's own "current" language.
const staticI18n = i18n.createInstance();
staticI18n.init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  defaultNS: "common",
  interpolation: { escapeValue: false },
});

export function translate(
  language: SupportedLanguage,
  key: string,
  ns: string,
  options?: Record<string, unknown>
): string {
  return staticI18n.t(key, { lng: language, ns, ...options }) as string;
}

import type { ClientActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData, useNavigate } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { setTokens, type TokenPair } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { translate, getLanguageFromCookieHeader } from "~/i18n/config";

// Loader function (optional for login, but good practice if you need to load initial data)
export const loader: LoaderFunction = async () => {
  return null; // No initial data needed for login page
};

// Runs in the browser: on success it must store the tokens in localStorage,
// which a server-side action has no access to. document.cookie (not the
// Request header - browsers won't expose Cookie on a fetch/Request object)
// is how the current UI language is read here for error messages, since
// this runs outside React and can't use the useTranslation() hook.
export const clientAction: ClientActionFunction = async ({ request }) => {
  const language = getLanguageFromCookieHeader(document.cookie);
  const t = (key: string) => translate(language, key, "auth");

  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  const errors: { [key: string]: string } = {};

  if (typeof email !== "string" || !email.includes("@")) {
    errors.email = t("login.errors.invalid_email");
  }
  if (typeof password !== "string" || password.length < 1) { // Password can't be empty
    errors.password = t("login.errors.password_empty");
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/login/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle specific backend errors
      if (response.status === 401) {
        errors.general = extractErrorMessage(data, t("login.errors.wrong_credentials"));
      } else if (response.status === 403) {
        errors.general = extractErrorMessage(data, t("login.errors.account_inactive"));
      } else {
        errors.general = extractErrorMessage(data, t("login.errors.generic_failure"));
      }
      return { errors };
    }

    const tokens = data as TokenPair;
    setTokens(tokens);
    return { loggedIn: true };
  } catch (error) {
    console.error("Login failed (action):", error);
    return { errors: { general: t("login.errors.unexpected") } };
  }
};

export default function LoginPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string }, loggedIn?: boolean } | undefined;
  const navigate = useNavigate();
  const { t } = useTranslation("auth");

  useEffect(() => {
    if (actionData?.loggedIn) {
      navigate("/profile");
    }
  }, [actionData, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("login.heading")}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            {t("login.or_prefix")} <a href="/register" className="font-medium text-red-600 hover:text-red-500">{t("login.register_link")}</a>
          </p>
        </div>
        <Form className="mt-8 space-y-6" method="post"> {/* Use Form component and method="post" */}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">{t("login.email_placeholder")}</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder={t("login.email_placeholder") ?? undefined}
              />
              {actionData?.errors?.email && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.email}</p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="sr-only">{t("login.password_placeholder")}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm mt-3"
                placeholder={t("login.password_placeholder") ?? undefined}
              />
              {actionData?.errors?.password && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.password}</p>
              )}
            </div>
          </div>

          {actionData?.errors?.general && (
            <p className="mt-2 text-sm text-red-500 text-center">{actionData.errors.general}</p>
          )}

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <a href="/forgot-password" className="font-medium text-red-600 hover:text-red-500">
                {t("login.forgot_password")}
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              {t("login.submit")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

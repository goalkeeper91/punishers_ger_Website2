import type { ClientActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData } from "react-router";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";
import { translate, getLanguageFromCookieHeader } from "~/i18n/config";

export const loader: LoaderFunction = async () => {
  return null;
};

// Runs in the browser: VITE_API_BASE_URL is a relative path in production
// ("/api"), which only resolves against a page origin - a server-side
// action has none, so this must be a clientAction (see login.tsx).
export const clientAction: ClientActionFunction = async ({ request }) => {
  const language = getLanguageFromCookieHeader(document.cookie);
  const t = (key: string) => translate(language, key, "auth");

  const formData = await request.formData();
  const email = formData.get("email");

  if (typeof email !== "string" || !email.includes("@")) {
    return { errors: { email: t("forgot_password.errors.invalid_email") } };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/password-reset/request/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { errors: { general: extractErrorMessage(data, t("forgot_password.errors.generic_failure")) } };
    }

    // Backend always returns the same generic message, whether or not the
    // address is registered, so this can't be used to enumerate accounts.
    return { submitted: true };
  } catch (error) {
    console.error("Password reset request failed:", error);
    return { errors: { general: t("forgot_password.errors.unexpected") } };
  }
};

export default function ForgotPasswordPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string }; submitted?: boolean } | undefined;
  const { t } = useTranslation("auth");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("forgot_password.heading")}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            {t("forgot_password.description")}
          </p>
        </div>

        {actionData?.submitted ? (
          <p className="text-center text-gray-300">
            {t("forgot_password.success_message")}
          </p>
        ) : (
          <Form className="mt-8 space-y-6" method="post">
            <div>
              <label htmlFor="email-address" className="sr-only">{t("forgot_password.email_placeholder")}</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder={t("forgot_password.email_placeholder") ?? undefined}
              />
              {actionData?.errors?.email && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.email}</p>
              )}
            </div>

            {actionData?.errors?.general && (
              <p className="mt-2 text-sm text-red-500 text-center">{actionData.errors.general}</p>
            )}

            <div>
              <button
                type="submit"
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {t("forgot_password.submit")}
              </button>
            </div>
          </Form>
        )}

        <p className="mt-2 text-center text-sm text-gray-400">
          <a href="/login" className="font-medium text-red-600 hover:text-red-500">{t("forgot_password.back_to_login")}</a>
        </p>
      </div>
    </div>
  );
}

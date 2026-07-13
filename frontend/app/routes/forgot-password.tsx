import type { ActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData } from "react-router";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";

export const loader: LoaderFunction = async () => {
  return null;
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const email = formData.get("email");

  if (typeof email !== "string" || !email.includes("@")) {
    return { errors: { email: "Ungültige E-Mail Adresse." } };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/password-reset/request/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { errors: { general: extractErrorMessage(data, "Anfrage fehlgeschlagen. Bitte versuchen Sie es erneut.") } };
    }

    // Backend always returns the same generic message, whether or not the
    // address is registered, so this can't be used to enumerate accounts.
    return { submitted: true };
  } catch (error) {
    console.error("Password reset request failed:", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function ForgotPasswordPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string }; submitted?: boolean } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Passwort vergessen?
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Gib deine E-Mail Adresse ein, wir schicken dir einen Link zum Zurücksetzen.
          </p>
        </div>

        {actionData?.submitted ? (
          <p className="text-center text-gray-300">
            Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir einen Link zum Zurücksetzen des Passworts geschickt. Bitte prüfe dein Postfach.
          </p>
        ) : (
          <Form className="mt-8 space-y-6" method="post">
            <div>
              <label htmlFor="email-address" className="sr-only">E-Mail Adresse</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="E-Mail Adresse"
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
                Link anfordern
              </button>
            </div>
          </Form>
        )}

        <p className="mt-2 text-center text-sm text-gray-400">
          <a href="/login" className="font-medium text-red-600 hover:text-red-500">Zurück zur Anmeldung</a>
        </p>
      </div>
    </div>
  );
}

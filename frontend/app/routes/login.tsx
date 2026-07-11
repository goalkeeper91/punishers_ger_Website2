import type { ClientActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData, useNavigate } from "react-router";
import { useEffect } from "react";
import { API_BASE_URL } from "~/lib/config";
import { setTokens, type TokenPair } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";

// Loader function (optional for login, but good practice if you need to load initial data)
export const loader: LoaderFunction = async () => {
  return null; // No initial data needed for login page
};

// Runs in the browser: on success it must store the tokens in localStorage,
// which a server-side action has no access to.
export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");

  const errors: { [key: string]: string } = {};

  if (typeof email !== "string" || !email.includes("@")) {
    errors.email = "Ungültige E-Mail Adresse.";
  }
  if (typeof password !== "string" || password.length < 1) { // Password can't be empty
    errors.password = "Passwort darf nicht leer sein.";
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
        errors.general = extractErrorMessage(data, "E-Mail oder Passwort ist falsch.");
      } else if (response.status === 403) {
        errors.general = extractErrorMessage(data, "Dein Konto ist noch nicht aktiviert. Bitte warte auf die Freischaltung durch einen Administrator.");
      } else {
        errors.general = extractErrorMessage(data, "Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.");
      }
      return { errors };
    }

    const tokens = data as TokenPair;
    setTokens(tokens);
    return { loggedIn: true };
  } catch (error) {
    console.error("Login failed (action):", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function LoginPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string }, loggedIn?: boolean } | undefined;
  const navigate = useNavigate();

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
            Bei deinem Konto anmelden
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Oder <a href="/register" className="font-medium text-red-600 hover:text-red-500">erstelle ein neues Konto</a>
          </p>
        </div>
        <Form className="mt-8 space-y-6" method="post"> {/* Use Form component and method="post" */}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">E-Mail Adresse</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="E-Mail Adresse"
              />
              {actionData?.errors?.email && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.email}</p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Passwort</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm mt-3"
                placeholder="Passwort"
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
              <a href="#" className="font-medium text-red-600 hover:text-red-500">
                Passwort vergessen?
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Anmelden
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

import type { ActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigate } from "react-router";
import { useEffect } from "react";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";

export const loader: LoaderFunction = async ({ request }) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return { token };
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const token = formData.get("token");
  const newPassword = formData.get("new_password");
  const confirmPassword = formData.get("confirm_password");

  const errors: { [key: string]: string } = {};

  if (typeof token !== "string" || !token) {
    errors.general = "Der Link ist ungültig. Bitte fordere einen neuen an.";
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    errors.newPassword = "Passwort muss mindestens 6 Zeichen lang sein.";
  }
  if (newPassword !== confirmPassword) {
    errors.confirmPassword = "Passwörter stimmen nicht überein.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/password-reset/confirm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { errors: { general: extractErrorMessage(data, "Zurücksetzen fehlgeschlagen. Bitte versuchen Sie es erneut.") } };
    }

    return { success: true };
  } catch (error) {
    console.error("Password reset confirm failed:", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function ResetPasswordPage() {
  const { token } = useLoaderData() as { token: string };
  const actionData = useActionData() as { errors?: { [key: string]: string }; success?: boolean } | undefined;
  const navigate = useNavigate();

  useEffect(() => {
    if (actionData?.success) {
      const timeout = setTimeout(() => navigate("/login"), 2500);
      return () => clearTimeout(timeout);
    }
  }, [actionData, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          Neues Passwort festlegen
        </h2>

        {actionData?.success ? (
          <p className="text-center text-gray-300">
            Dein Passwort wurde zurückgesetzt. Du wirst gleich zur Anmeldung weitergeleitet...
          </p>
        ) : !token ? (
          <p className="text-center text-sm text-red-500">
            Dieser Link ist ungültig. Bitte fordere unter{" "}
            <a href="/forgot-password" className="font-medium text-red-600 hover:text-red-500">Passwort vergessen</a> einen neuen an.
          </p>
        ) : (
          <Form className="mt-8 space-y-6" method="post">
            <input type="hidden" name="token" value={token} />
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="new_password" className="sr-only">Neues Passwort</label>
                <input
                  id="new_password"
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                  placeholder="Neues Passwort"
                />
                {actionData?.errors?.newPassword && (
                  <p className="mt-2 text-sm text-red-500">{actionData.errors.newPassword}</p>
                )}
              </div>
              <div className="mt-3">
                <label htmlFor="confirm_password" className="sr-only">Passwort bestätigen</label>
                <input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                  placeholder="Passwort bestätigen"
                />
                {actionData?.errors?.confirmPassword && (
                  <p className="mt-2 text-sm text-red-500">{actionData.errors.confirmPassword}</p>
                )}
              </div>
            </div>

            {actionData?.errors?.general && (
              <p className="mt-2 text-sm text-red-500 text-center">{actionData.errors.general}</p>
            )}

            <div>
              <button
                type="submit"
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Passwort speichern
              </button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}

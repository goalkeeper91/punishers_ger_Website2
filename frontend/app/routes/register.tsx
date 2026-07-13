import type { ActionFunction, LoaderFunction } from "react-router";
import { Form, useActionData, redirect } from "react-router"; // Import Form and useActionData
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";

// Removed Remix-specific MetaFunction
// export const meta: MetaFunction = () => { // Removed Remix-specific MetaFunction
//   return [
//     { title: "Registrieren - Punishers Germany" },
//     { name: "description", content: "Erstelle ein neues Konto bei Punishers Germany." },
//   ];
// };

// Loader function (optional for register, but good practice if you need to load initial data)
export const loader: LoaderFunction = async () => {
  return null; // No initial data needed for registration page
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const username = formData.get("username");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm-password");

  const errors: { [key: string]: string } = {};

  if (typeof username !== "string" || username.length < 3) {
    errors.username = "Benutzername muss mindestens 3 Zeichen lang sein.";
  }
  if (typeof email !== "string" || !email.includes("@")) {
    errors.email = "Ungültige E-Mail Adresse.";
  }
  if (typeof password !== "string" || password.length < 6) {
    errors.password = "Passwort muss mindestens 6 Zeichen lang sein.";
  }
  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwörter stimmen nicht überein.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/register/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      // The backend never reveals whether an email is already registered
      // (see fastapi_app/main.py register_user) - only the username-taken
      // case is a distinct, safe-to-show field error; everything else
      // (weak/similar password, ...) is a general error.
      const message = extractErrorMessage(data, "Registrierung fehlgeschlagen. Bitte versuchen Sie es erneut.");
      if (response.status === 400 && message === "Username already registered") {
        errors.username = "Dieser Benutzername ist bereits vergeben.";
      } else {
        errors.general = message;
      }
      return { errors };
    }

    // Redirect to a success page or login page after successful registration
    return redirect("/register-success"); // You might want to create this page
  } catch (error) {
    console.error("Registration failed:", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function RegisterPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string } } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Neues Konto erstellen
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Oder <a href="/login" className="font-medium text-red-600 hover:text-red-500">melde dich an, wenn du bereits ein Konto hast</a>
          </p>
        </div>
        <Form className="mt-8 space-y-6" method="post"> {/* Use Form component and method="post" */}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="username" className="sr-only">Benutzername</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Benutzername"
              />
              {actionData?.errors?.username && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.username}</p>
              )}
            </div>
            <div className="mt-3">
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
            <div className="mt-3">
              <label htmlFor="password" className="sr-only">Passwort</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 placeholder-gray-500 text-white bg-gray-700 focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Passwort"
              />
              {actionData?.errors?.password && (
                <p className="mt-2 text-sm text-red-500">{actionData.errors.password}</p>
              )}
            </div>
            <div className="mt-3">
              <label htmlFor="confirm-password" className="sr-only">Passwort bestätigen</label>
              <input
                id="confirm-password"
                name="confirm-password"
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
              Registrieren
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

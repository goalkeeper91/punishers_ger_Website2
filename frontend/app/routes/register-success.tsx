import React from 'react';

export default function RegisterSuccessPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl text-center">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          Registrierung erfolgreich!
        </h2>
        <p className="mt-2 text-lg text-gray-300">
          Dein Konto wurde erfolgreich erstellt.
        </p>
        <p className="mt-2 text-md text-gray-400">
          Ein Administrator wird dein Konto prüfen und aktivieren. Du wirst benachrichtigt, sobald dein Konto aktiv ist.
        </p>
        <div className="mt-6">
          <a href="/login" className="font-medium text-red-600 hover:text-red-500">Zurück zur Anmeldung</a>
        </div>
      </div>
    </div>
  );
}

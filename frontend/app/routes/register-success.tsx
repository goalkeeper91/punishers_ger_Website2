import React from 'react';
import { useTranslation } from "react-i18next";

export default function RegisterSuccessPage() {
  const { t } = useTranslation("auth");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 p-10 bg-gray-800 rounded-lg shadow-xl text-center">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          {t("register_success.heading")}
        </h2>
        <p className="mt-2 text-lg text-gray-300">
          {t("register_success.account_created")}
        </p>
        <p className="mt-2 text-md text-gray-400">
          {t("register_success.pending_activation")}
        </p>
        <div className="mt-6">
          <a href="/login" className="font-medium text-red-600 hover:text-red-500">{t("register_success.back_to_login")}</a>
        </div>
      </div>
    </div>
  );
}

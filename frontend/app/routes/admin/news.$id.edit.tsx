import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useRef } from "react";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { imageFallback } from "~/lib/sampleAssets";
import AdminNav from "~/components/AdminNav";
import MarkdownToolbar from "~/components/MarkdownToolbar";
import ImageCropInput from "~/components/ImageCropInput";

interface NewsArticle {
  id: number;
  title: string;
  slug: string;
  content: string;
  author_name: string | null;
  image_url: string | null;
  published_date: string;
  updated_date: string;
  status: string;
  original_language: string;
  is_machine_translated: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = { de: "Deutsch", en: "Englisch" };

export const clientLoader: ClientLoaderFunction = async ({ params }) => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const response = await authFetch(`/admin/news/${params.id}/`);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw redirect("/login");
    }
    if (response.status === 404) {
      throw redirect("/admin/news");
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const article: NewsArticle = await response.json();
  return { article };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const formType = formData.get("_formType");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (formType === "imageUpload") {
      const file = formData.get("image");
      if (!file || !(file instanceof File) || file.size === 0) {
        return { error: "Keine Datei ausgewählt." };
      }
      const imageFormData = new FormData();
      imageFormData.append("file", file);

      const response = await authFetch(`/admin/news/${params.id}/image/`, {
        method: "POST",
        body: imageFormData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Bild hochgeladen." };
    }

    if (formType === "update") {
      const title = formData.get("title");
      const slug = formData.get("slug");
      const content = formData.get("content");
      const articleStatus = formData.get("status");

      const response = await authFetch(`/admin/news/${params.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug, content, status: articleStatus }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Artikel konnte nicht gespeichert werden.") } };
      }
      return { success: "Artikel gespeichert." };
    }

    if (formType === "retranslate") {
      const response = await authFetch(`/admin/news/${params.id}/translate/`, { method: "POST" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Übersetzungen aktualisiert." };
    }

    return { error: "Unbekannter Formular-Typ." };
  } catch (error: any) {
    console.error("Failed to update news article:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminNewsEditPage() {
  const { article } = useLoaderData() as { article: NewsArticle };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const contentRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="news" />

        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.errors?.general && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        {/* Image Section */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Titelbild</h2>
          <div className="flex flex-col items-center md:flex-row md:items-start gap-8">
            <img
              className="w-48 h-32 object-cover rounded-md border border-gray-600"
              src={article.image_url || imageFallback("https://via.placeholder.com/300x200?text=No+Image")}
              alt={article.title}
            />
            <Form method="post" encType="multipart/form-data" className="space-y-4 flex-grow">
              <input type="hidden" name="_formType" value="imageUpload" />
              <ImageCropInput
                id="news_image"
                name="image"
                aspect={3 / 2}
                outputWidth={900}
                outputHeight={600}
                className="block w-full text-sm text-gray-300
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-red-600 file:text-white
                  hover:file:bg-red-700"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
              >
                Bild hochladen
              </button>
            </Form>
          </div>
        </div>

        {/* Details Section */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="text-2xl font-bold text-white">Artikeldetails</h2>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span>
                Erkannte Sprache: <span className="text-gray-200 font-semibold">{LANGUAGE_LABELS[article.original_language] ?? article.original_language}</span>
                {" "}– wird automatisch in die jeweils andere Sprache übersetzt.
              </span>
              <Form method="post">
                <input type="hidden" name="_formType" value="retranslate" />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:opacity-50 whitespace-nowrap"
                >
                  Neu übersetzen
                </button>
              </Form>
            </div>
          </div>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="_formType" value="update" />
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-300">Titel <span className="text-red-500">*</span></label>
              <input
                type="text"
                id="title"
                name="title"
                defaultValue={article.title}
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-gray-300">Slug <span className="text-red-500">*</span></label>
              <input
                type="text"
                id="slug"
                name="slug"
                defaultValue={article.slug}
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="content" className="block text-sm font-medium text-gray-300 mb-1">Inhalt <span className="text-red-500">*</span></label>
              <MarkdownToolbar textareaRef={contentRef} />
              <textarea
                id="content"
                name="content"
                ref={contentRef}
                rows={12}
                defaultValue={article.content}
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-300">Status</label>
              <select
                id="status"
                name="status"
                defaultValue={article.status}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                <option value="draft">Entwurf</option>
                <option value="published">Veröffentlicht</option>
              </select>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
              >
                {isSubmitting ? "Wird gespeichert..." : "Speichern"}
              </button>
              <a
                href="/admin/news"
                className="inline-flex justify-center py-2 px-4 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 hover:bg-gray-700"
              >
                Zurück zur Liste
              </a>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}

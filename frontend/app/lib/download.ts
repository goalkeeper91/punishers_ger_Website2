// Triggers a browser download for an authenticated, non-public file (e.g. a
// Pracc demo served from GET /gameservers/praccs/{id}/demo/ - that endpoint
// deliberately isn't a plain public URL, see backend/gameservers/models.py's
// Pracc.demo_filename docstring, so it has to be fetched with the user's
// auth header and turned into a Blob rather than just set as an <a href>.

import { authFetch } from "./auth";
import { extractErrorMessage } from "./errors";

export async function downloadAuthenticatedFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await authFetch(path);
  if (!response.ok) {
    let message = `HTTP-Fehler: ${response.status}`;
    try {
      message = extractErrorMessage(await response.json(), message);
    } catch {
      // Non-JSON error body (e.g. a plain-text 410) - keep the generic message.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

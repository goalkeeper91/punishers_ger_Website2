// A plain FastAPI HTTPException gives {detail: "some string"}, but a 422
// Pydantic validation error gives {detail: [{type, loc, msg, input, ctx}, ...]}
// - a validation-error array, never a string. Rendering that array directly
// as a React child crashes ("Objects are not valid as a React child"), so
// every call site handling an API error response must go through this
// instead of trusting `data.detail` directly.
export function extractErrorMessage(data: unknown, fallback: string): string {
  const detail = (data as { detail?: unknown } | null | undefined)?.detail;

  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : String(item)
      )
      .join(" ");
  }

  return fallback;
}

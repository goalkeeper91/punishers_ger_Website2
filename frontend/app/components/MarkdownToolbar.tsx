import { useCallback } from "react";

// Inserts Markdown syntax around the current textarea selection - no rich
// text editor dependency needed for authoring. Rendering happens via
// react-markdown (see news.$slug.tsx), which parses only recognized
// Markdown syntax into React elements - raw HTML in the content is never
// interpreted, so this can't become a stored-XSS vector the way a
// dangerouslySetInnerHTML-based "HTML paste" editor could.

interface MarkdownAction {
  label: string;
  title: string;
  prefix: string;
  suffix: string;
  placeholder: string;
}

const ACTIONS: MarkdownAction[] = [
  { label: "B", title: "Fett", prefix: "**", suffix: "**", placeholder: "fetter Text" },
  { label: "I", title: "Kursiv", prefix: "_", suffix: "_", placeholder: "kursiver Text" },
  { label: "H2", title: "Überschrift", prefix: "## ", suffix: "", placeholder: "Überschrift" },
  { label: "❝", title: "Zitat", prefix: "> ", suffix: "", placeholder: "Zitat" },
  { label: "•", title: "Liste", prefix: "- ", suffix: "", placeholder: "Listeneintrag" },
  { label: "1.", title: "Nummerierte Liste", prefix: "1. ", suffix: "", placeholder: "Listeneintrag" },
  { label: "Link", title: "Link", prefix: "[", suffix: "](https://)", placeholder: "Linktext" },
];

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function MarkdownToolbar({ textareaRef }: MarkdownToolbarProps) {
  const applyAction = useCallback(
    (action: MarkdownAction) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const before = value.slice(0, start);
      const after = value.slice(end);

      // A double-click word selection often grabs a trailing space (e.g.
      // "Willkommen "), which would land INSIDE the closing marker -
      // "**Willkommen **" isn't valid CommonMark emphasis (the character
      // right before a closing "**" can't be whitespace), so it would
      // render as literal asterisks instead of bold text. Keep any
      // surrounding whitespace outside the wrap instead.
      const rawSelected = value.slice(start, end);
      const trimmed = rawSelected.trim();
      const leadingSpace = rawSelected.slice(0, rawSelected.length - rawSelected.trimStart().length);
      const trailingSpace = rawSelected.slice(rawSelected.trimEnd().length);
      const content = trimmed || action.placeholder;

      textarea.value = `${before}${leadingSpace}${action.prefix}${content}${action.suffix}${trailingSpace}${after}`;

      const cursorStart = before.length + leadingSpace.length + action.prefix.length;
      textarea.focus();
      textarea.setSelectionRange(cursorStart, cursorStart + content.length);
    },
    [textareaRef]
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2 p-2 bg-gray-900 rounded-md border border-gray-700">
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.title}
            onClick={() => applyAction(action)}
            className="px-3 py-1 text-sm font-semibold bg-gray-700 text-gray-200 rounded hover:bg-gray-600 transition-colors duration-150"
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-2">
        Unterstützt Markdown: <code>**fett**</code>, <code>_kursiv_</code>, <code>## Überschrift</code>,{" "}
        <code>- Liste</code>, <code>[Link](url)</code>
      </p>
    </div>
  );
}

import { useId } from "react";

// Placeholder crest for teams that haven't uploaded a logo. Drawn from
// scratch (no third-party game logos - we have no rights to reproduce
// those, same reasoning as backend/social_posts/image_generation.py) and
// deliberately keyed to the same per-game abbreviation + accent color table
// as that backend module, so a team's site placeholder and its generated
// social-post image read as the same identity. GAME_STYLES must be kept in
// sync with the backend list by hand.
const GAME_STYLES: { keywords: string[]; abbr: string; color: string }[] = [
  { keywords: ["cs2", "counter-strike", "counter strike"], abbr: "CS2", color: "#f97316" },
  { keywords: ["valorant"], abbr: "VAL", color: "#ff4655" },
  { keywords: ["league of legends", "lol"], abbr: "LOL", color: "#c89b3c" },
  { keywords: ["rocket league"], abbr: "RL", color: "#0091ff" },
  { keywords: ["rainbow six", "r6", "siege"], abbr: "R6", color: "#f2a900" },
];
const DEFAULT_COLOR = "#dc2626"; // the site's accent red, for unrecognized games
const ORG_WORDS = new Set(["punishers", "germany", "team"]);

function gameStyle(game?: string | null): { abbr: string; color: string } | null {
  if (!game) return null;
  const lower = game.toLowerCase();
  const match = GAME_STYLES.find((style) => style.keywords.some((kw) => lower.includes(kw)));
  return match ? { abbr: match.abbr, color: match.color } : null;
}

// Fallback label when the game isn't recognized: initials of the team name
// minus the org words every team shares ("Punishers Female" -> "F").
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word && !ORG_WORDS.has(word.toLowerCase()))
    .map((word) => word[0].toUpperCase())
    .join("")
    .slice(0, 3);
  return letters || "PG";
}

interface TeamLogoProps {
  name: string;
  game?: string | null;
  imageUrl?: string | null;
  /** Classes for the real uploaded <img>. */
  imgClassName?: string;
  /** Classes for the placeholder <svg> (it is square - size it with h-/w-). */
  placeholderClassName?: string;
}

export default function TeamLogo({
  name,
  game,
  imageUrl,
  imgClassName = "max-w-full max-h-full object-contain",
  placeholderClassName = "h-36 w-36",
}: TeamLogoProps) {
  // useId() yields ":r0:"-style ids; the colons break url(#...) references.
  const uid = useId().replace(/:/g, "");

  if (imageUrl) {
    return <img src={imageUrl} alt={name} className={imgClassName} />;
  }

  const style = gameStyle(game);
  const color = style?.color ?? DEFAULT_COLOR;
  const label = style?.abbr ?? initials(name);

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={name}
      className={placeholderClassName}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${uid}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor="#14396f" />
          <stop offset="100%" stopColor="#050b18" />
        </radialGradient>
        <filter id={`${uid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`${uid}-clip`}>
          <circle cx="100" cy="100" r="90" />
        </clipPath>
      </defs>

      <circle cx="100" cy="100" r="92" fill={`url(#${uid}-bg)`} />
      {/* diagonal accents, echoing the generated social-post template */}
      <g clipPath={`url(#${uid}-clip)`} stroke={color} strokeOpacity="0.28" strokeWidth="2">
        <line x1="-20" y1="150" x2="150" y2="-20" />
        <line x1="20" y1="215" x2="215" y2="20" />
      </g>
      <circle cx="100" cy="100" r="92" fill="none" stroke={color} strokeWidth="6" filter={`url(#${uid}-glow)`} />
      <circle cx="100" cy="100" r="80" fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="1.5" />

      <text
        x="100"
        y="116"
        textAnchor="middle"
        fontFamily="'Inter Variable', Inter, system-ui, sans-serif"
        fontWeight="800"
        fontSize={label.length > 2 ? 54 : 64}
        letterSpacing="1"
        fill="#ffffff"
      >
        {label}
      </text>
      <text
        x="100"
        y="146"
        textAnchor="middle"
        fontFamily="'Inter Variable', Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize="13"
        letterSpacing="4"
        fill={color}
      >
        PUNISHERS
      </text>
    </svg>
  );
}

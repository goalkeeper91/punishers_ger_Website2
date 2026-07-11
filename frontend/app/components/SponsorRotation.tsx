import { useEffect, useState } from "react";
import { trackSponsorClick, type Sponsor } from "~/lib/publicContent";

const ROTATION_INTERVAL_MS = 4500;

/**
 * Prominent, auto-rotating sponsor showcase for the home page - the pitch
 * being "this is what your logo could look like here" for prospective
 * partners. Pauses on hover/focus so visitors can actually read a card.
 */
export default function SponsorRotation({ sponsors }: { sponsors: Sponsor[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (sponsors.length <= 1 || paused) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % sponsors.length);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sponsors.length, paused]);

  if (sponsors.length === 0) return null;

  const current = sponsors[index % sponsors.length];

  return (
    <section className="py-16 md:py-20 bg-gray-900">
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Unsere Partner</h2>
        <p className="text-gray-400 mb-10 max-w-2xl mx-auto">
          Von diesen starken Marken werden wir unterstützt — und so präsentieren wir sie.
        </p>

        <div
          className="max-w-xl mx-auto"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="bg-gray-800 rounded-2xl shadow-xl p-8 md:p-10 min-h-[220px] flex flex-col items-center justify-center">
            <div key={current.id} className="motion-safe:animate-fade-in flex flex-col items-center">
              <div className="h-20 md:h-24 flex items-center justify-center mb-5">
                <img
                  src={current.logo_url || `https://via.placeholder.com/240x100?text=${encodeURIComponent(current.name)}`}
                  alt={current.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <p className="text-xl font-semibold text-white mb-1">{current.name}</p>
              {current.tier === "premium" && (
                <span className="inline-block mb-3 px-3 py-1 bg-red-600/20 text-red-500 text-xs font-semibold uppercase tracking-wider rounded-full">
                  Premium Partner
                </span>
              )}
              {current.website_url && (
                <a
                  href={current.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSponsorClick(current.id)}
                  className="text-red-500 hover:text-red-400 text-sm font-medium transition-colors duration-200"
                >
                  Website besuchen →
                </a>
              )}
            </div>
          </div>

          {sponsors.length > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              {sponsors.map((sponsor, i) => (
                <button
                  key={sponsor.id}
                  onClick={() => setIndex(i)}
                  aria-label={`${sponsor.name} anzeigen`}
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-6 bg-red-600" : "w-2.5 bg-gray-600 hover:bg-gray-500"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-gray-400 mt-10">
          Interesse an einer Partnerschaft?{" "}
          <a href="/sponsors" className="text-red-600 hover:underline font-semibold">
            Alle Partner ansehen
          </a>{" "}
          oder{" "}
          <a href="/contact" className="text-red-600 hover:underline font-semibold">
            kontaktiere uns
          </a>
          .
        </p>
      </div>
    </section>
  );
}

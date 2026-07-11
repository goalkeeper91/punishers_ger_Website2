import { USE_SAMPLE_ASSETS } from "~/lib/config";

/**
 * Background layer for the hero section. The poster image is always the
 * base layer (so there's never a blank background), with extra motion on
 * top of it:
 * - Sample mode: an animated CSS pulse/scanline effect (no real video asset
 *   exists yet, but it should still look intentional).
 * - Production mode: a real <video>, hidden on small screens and for
 *   prefers-reduced-motion so the poster image is used instead. Drop a real
 *   esports montage at public/videos/hero-background.mp4 to activate it.
 */
export default function HeroBackground({
  posterUrl,
  videoSrc = "/videos/hero-background.mp4",
}: {
  posterUrl: string;
  videoSrc?: string;
}) {
  return (
    <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${posterUrl}')` }} aria-hidden="true">
      {USE_SAMPLE_ASSETS ? (
        <div className="absolute inset-0 hero-scanlines motion-safe:animate-hero-scan" />
      ) : (
        <video
          className="absolute inset-0 w-full h-full object-cover hidden sm:block motion-reduce:hidden"
          autoPlay
          muted
          loop
          playsInline
          poster={posterUrl}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

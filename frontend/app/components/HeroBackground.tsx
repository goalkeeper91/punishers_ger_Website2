/**
 * Background layer for the hero section. The poster image is always the
 * base layer (so there's never a blank background), with extra motion on
 * top of it:
 * - No hero video uploaded yet (or sample mode): an animated CSS
 *   pulse/scanline effect, so it still looks intentional rather than blank.
 * - Once an admin uploads a hero video (see /admin/site-settings): a real
 *   <video>, hidden on small screens and for prefers-reduced-motion so the
 *   poster image is used instead.
 */
export default function HeroBackground({
  posterUrl,
  videoUrl,
}: {
  posterUrl: string;
  videoUrl?: string | null;
}) {
  return (
    <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${posterUrl}')` }} aria-hidden="true">
      {videoUrl ? (
        <video
          className="absolute inset-0 w-full h-full object-cover hidden sm:block motion-reduce:hidden"
          autoPlay
          muted
          loop
          playsInline
          poster={posterUrl}
        >
          <source src={videoUrl} />
        </video>
      ) : (
        <div className="absolute inset-0 hero-scanlines motion-safe:animate-hero-scan" />
      )}
    </div>
  );
}

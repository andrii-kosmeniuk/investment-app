import Image from "next/image";

const COINS = 14;

/**
 * A quiet, infinite band of brand coins between the hero and the field guide,
 * in the manner of a partner-logo strip. Two identical tracks slide together;
 * when the first has moved its own width the loop restarts invisibly. Purely
 * decorative: hidden from assistive tech, paused under reduced motion.
 */
export function CoinMarquee() {
  const track = Array.from({ length: COINS }, (_, index) => (
    <Image key={index} src="/brand-coin-hero-128.png" alt="" width={128} height={128} className="coin-marquee__coin" />
  ));
  return (
    <div className="coin-marquee" aria-hidden="true">
      <div className="coin-marquee__viewport">
        <div className="coin-marquee__track">
          {track}
          {track}
        </div>
      </div>
    </div>
  );
}

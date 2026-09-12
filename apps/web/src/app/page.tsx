import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ModelResponse } from "@corgi/contracts";
import { AllocationBar, EnvironmentBadge, StatusPill } from "@corgi/ui";
import { Brand } from "../components/Brand";
import { CoinMarquee } from "../components/landing/CoinMarquee";
import { HeroArt } from "../components/landing/HeroArt";
import { LandingNav } from "../components/landing/LandingNav";
import { Plate } from "../components/landing/Plate";
import {
  FIELD_GUIDE,
  LANDING_SECTIONS,
  MODEL_RISK_WORD,
  ONBOARDING_STEPS,
  PROVIDERS,
} from "../lib/landing-copy";
import { PRODUCT_NAME } from "../lib/product";
import { anonymousApi } from "../server/api";
import { readSessionToken } from "../server/session";

const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

/**
 * Where each step sits on the level map, as percentages of the map box. The
 * cards zig-zag down the page; the dashed path below is drawn through the same
 * points, so the two can never drift apart.
 */
type Spot = { readonly x: number; readonly y: number };

const STEP_SPOTS: readonly Spot[] = [
  { x: 12, y: 28 },
  { x: 31, y: 72 },
  { x: 50, y: 28 },
  { x: 69, y: 72 },
  { x: 88, y: 28 },
];

/**
 * Hand-placed elbows between consecutive cards. Legs start and end under the
 * cards, so only the visible run between them matters: 01 steps right, down
 * and right into 02; 02 climbs out of its top and runs right into 03's side;
 * 03 leaves its right side, drops, and runs right into 04's side; 04 climbs
 * out of its top and runs right into 05's side.
 */
const STEP_ROUTES: readonly (readonly Spot[])[] = [
  [{ x: 21, y: 28 }, { x: 21, y: 72 }],
  [{ x: 35, y: 72 }, { x: 35, y: 33 }, { x: 50, y: 33 }],
  [{ x: 50, y: 33 }, { x: 60, y: 33 }, { x: 60, y: 72 }],
  [{ x: 70, y: 72 }, { x: 70, y: 33 }, { x: 88, y: 33 }],
];

function stepPath(): string {
  return STEP_SPOTS.map((spot, index) => {
    if (index === 0) return `M ${spot.x} ${spot.y}`;
    const elbows = STEP_ROUTES[index - 1] ?? [];
    return [...elbows, spot].map((point) => `L ${point.x} ${point.y}`).join(" ");
  }).join(" ");
}

/** The catalogue is product configuration; an unreachable API leaves the plate honest, not empty-handed. */
async function loadModels(): Promise<readonly ModelResponse[] | null> {
  try {
    return (await anonymousApi().publicModels()).models;
  } catch {
    return null;
  }
}

export default async function EntryPage() {
  if (await readSessionToken()) redirect("/overview");
  const models = await loadModels();

  return (
    <div className="landing">
      <LandingNav />

      <main id="top" className="entry landing__main">
        <section className="entry__grid entry__hero" aria-labelledby="hero-title">
          <Image
            src="/hero-field.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            quality={92}
            className="entry__hero-bg"
            aria-hidden="true"
          />
          <div className="entry__copy">
            <h1 id="hero-title">
              One Space,
              <br />
              for all <em className="entry__accent">Investments.</em>
            </h1>
            <p className="entry__lead">
              Fund from your bank, watch every order land, and see exactly what changed, when, and what was known,
              <br />
              all in one workspace.
            </p>
            <div className="entry__actions">
              <Link href="/sign-up" className="button" data-variant="primary">
                <span className="button__label">Create an account</span>
              </Link>
              <Link href="/sign-in" className="entry__signin">
                Sign in
              </Link>
            </div>
          </div>
          <HeroArt priority className="entry__hero-art" />
        </section>

        <CoinMarquee />

        <section id="how-it-works" className="steps" aria-labelledby="how-it-works-title">
          <div className="steps__head">
            <span className="section-numeral">I</span>
            <h2 id="how-it-works-title">Get Started Instantly</h2>
            <p>
              No confusion, no waiting. Browse in minutes.
              <br />
              Money moves only when you’re verified and ready.
            </p>
          </div>
          <div className="steps__map">
            <svg className="steps__path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={stepPath()} />
            </svg>
            <ol className="steps__list">
              {ONBOARDING_STEPS.map((step, index) => {
                const spot = STEP_SPOTS[index] ?? { x: 50, y: 50 };
                return (
                  <li key={step.title} className="step-card" style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>
                    <span className="step-card__number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="step-card__body">
                      <strong>{step.title}</strong>
                      <span>{step.detail}</span>
                    </div>
                    <span className="step-card__pixels" aria-hidden="true" />
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="models" className="models" aria-labelledby="models-title">
          <div className="steps__head">
            <span className="section-numeral">II</span>
            <h2 id="models-title">Model portfolios for everyone, in one room</h2>
            <p>
              No confusion, no fine print. Four fixed models, real target weights.
              <br />
              Settled cash invested to plan - all in one room.
            </p>
          </div>
          {models && models.length > 0 ? (
            <ul className="models__grid">
              {models.map((model) => (
                <li key={model.id} className="model-card" tabIndex={0}>
                  <div className="model-card__head">
                    <span className="model-card__risk">{MODEL_RISK_WORD[model.riskLevel] ?? "Model"}</span>
                    <strong>{model.name}</strong>
                  </div>
                  <div className="model-card__bar">
                    <AllocationBar
                      label={`${model.name} target weights`}
                      segments={model.allocations.map((leg) => ({ symbol: leg.symbol, weightBps: leg.targetWeightBps }))}
                    />
                  </div>
                  <div className="model-card__more">
                    <dl>
                      <div>
                        <dt>Risk</dt>
                        <dd>{model.riskLevel} of 5</dd>
                      </div>
                      <div>
                        <dt>Cash buffer</dt>
                        <dd>{pct(model.cashBufferBps)}</dd>
                      </div>
                      <div>
                        <dt>Funds</dt>
                        <dd>{model.allocations.length}</dd>
                      </div>
                    </dl>
                    <ul className="model-card__legs">
                      {model.allocations.map((leg) => (
                        <li key={leg.symbol}>
                          <span>{leg.symbol}</span>
                          <span className="numeric">{pct(leg.targetWeightBps)}</span>
                        </li>
                      ))}
                    </ul>
                    <span className="model-card__hint">Rebalanced monthly to these weights.</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="plate__fallback">The model catalogue is unavailable right now; it is shown in full once you sign in.</p>
          )}
        </section>

        <Plate id="restatements" numeral="III" title="See exactly what changed" figure={FIELD_GUIDE.clouds}>
          <p>
            No confusion, no silent rewrites. Published and corrected, side by side.
            <br />
            Every version on the ledger - dated when it was known.
          </p>
          <div className="plate__compare" role="group" aria-label="Illustration of a restated return">
            <div>
              <span className="plate__compare-label">As published · Sep 8</span>
              <span className="plate__compare-value numeric">+3.41%</span>
            </div>
            <span className="plate__compare-arrow" aria-hidden="true">
              →
            </span>
            <div>
              <span className="plate__compare-label">As corrected · Sep 10</span>
              <span className="plate__compare-value numeric">+3.52%</span>
              <StatusPill tone="info">Return updated</StatusPill>
              <span className="plate__compare-reason">Late dividend, effective Sep 5</span>
            </div>
          </div>
          <p className="plate__note">Illustrative figures. Your own history shows every version with its reason.</p>
        </Plate>

        <Plate id="sandbox" numeral="IV" title="Built on Sandboxes" figure={FIELD_GUIDE.garden} flip>
          <p>
            No real money, no fake success. Every provider named - every gap shown honestly.
            <br />
            Unavailable beats unproven, every time.
          </p>
          <dl className="plate__providers">
            {PROVIDERS.map((provider) => (
              <div key={provider.name}>
                <dt>{provider.name}</dt>
                <dd>{provider.role}</dd>
              </div>
            ))}
          </dl>
          <p className="plate__badge">
            <EnvironmentBadge environment="sandbox" />
          </p>
        </Plate>

        <section className="landing__close" aria-labelledby="close-title">
          <h2 id="close-title">Start in under a minute.</h2>
          <p className="entry__lead">
            No confusion, no commitment. Create an account - it moves no money.
            <br />
            Verify, link your bank, and fund when you&apos;re ready.
          </p>
          <div className="entry__actions">
            <Link href="/sign-up" className="button" data-variant="primary">
              <span className="button__label">Create an account</span>
            </Link>
            <Link href="/sign-in" className="entry__signin">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <div className="landing__horizon" aria-hidden="true">
        <div className="landing__horizon-frames">
          <Image
            src="/plates/footer-a.png"
            alt=""
            width={2100}
            height={500}
            unoptimized
            className="landing__horizon-frame landing__horizon-frame--a"
          />
          <Image
            src="/plates/footer-b.png"
            alt=""
            width={2100}
            height={500}
            unoptimized
            className="landing__horizon-frame landing__horizon-frame--b"
          />
        </div>
      </div>

      <footer className="landing__footer">
        <Brand />
        <nav aria-label="Footer">
          {LANDING_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
          <Link href="/sign-in" className="entry__signin">
            Sign in
          </Link>
          <Link href="/sign-up" className="button" data-variant="primary">
            <span className="button__label">Create an account</span>
          </Link>
        </nav>
        <p className="muted">
          {PRODUCT_NAME} · work-trial build. Sandbox providers only; nothing on this site is an offer, a recommendation, or
          a promise of any outcome.
        </p>
      </footer>
    </div>
  );
}

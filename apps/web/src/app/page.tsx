import Link from "next/link";
import { redirect } from "next/navigation";
import type { ModelResponse } from "@corgi/contracts";
import { AllocationBar, EnvironmentBadge, StatusPill } from "@corgi/ui";
import { Brand } from "../components/Brand";
import { CharacterField } from "../components/CharacterField";
import { LandingNav } from "../components/landing/LandingNav";
import { Plate } from "../components/landing/Plate";
import {
  FIELD_GUIDE,
  LANDING_SECTIONS,
  MODEL_RISK_WORD,
  ONBOARDING_STEPS,
  PROVIDERS,
} from "../lib/landing-copy";
import { anonymousApi } from "../server/api";
import { readSessionToken } from "../server/session";

const facts = [
  "Identity verification before any money moves",
  "Deposits from a linked bank account",
  "Four model portfolios, rebalanced monthly",
  "Returns restated, never rewritten",
] as const;

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
        <section className="entry__grid" aria-labelledby="hero-title">
          <div className="entry__copy">
            <h1 id="hero-title">A clearer view of your investments.</h1>
            <p className="entry__lead">
              Fund a model portfolio from your bank, watch every order land, and see exactly what changed, when, and
              what was known at the time.
            </p>
            <div className="entry__actions">
              <Link href="/sign-up" className="button" data-variant="primary">
                <span className="button__label">Create an account</span>
              </Link>
              <Link href="/sign-in" className="text-link entry__secondary">
                Sign in
              </Link>
            </div>
          </div>
          <div className="entry__art" aria-hidden="true">
            <CharacterField animate inkVar="--ink-strong" className="entry__canvas" />
          </div>
        </section>

        <ol className="entry__facts">
          {facts.map((fact, index) => (
            <li key={fact}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {fact}
            </li>
          ))}
        </ol>

        <Plate id="how-it-works" numeral="I" title="Five steps, in order." figure={FIELD_GUIDE.stone}>
          <p>
            Each step is confirmed by the provider or by the ledger — never by a redirect. You can look around after the
            first one; money moves only after the second.
          </p>
          <ol className="plate__steps">
            {ONBOARDING_STEPS.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </Plate>

        <Plate id="models" numeral="II" title="Four model portfolios, nothing else." figure={FIELD_GUIDE.garden} flip>
          <p>
            Each model is a fixed set of funds with target weights. Your settled cash is invested to those weights, less
            a small cash buffer, and the portfolio is rebalanced back to them. Risk is described in words, never as safe or
            unsafe.
          </p>
          {models && models.length > 0 ? (
            <ul className="plate__models">
              {models.map((model) => (
                <li key={model.id}>
                  <div className="plate__model-head">
                    <strong>{model.name}</strong>
                    <span className="muted">
                      {MODEL_RISK_WORD[model.riskLevel] ?? "Model"} · risk {model.riskLevel}/5 · cash buffer{" "}
                      {(model.cashBufferBps / 100).toFixed(model.cashBufferBps % 100 === 0 ? 0 : 2)}%
                    </span>
                  </div>
                  <AllocationBar
                    label={`${model.name} target weights`}
                    segments={model.allocations.map((leg) => ({ symbol: leg.symbol, weightBps: leg.targetWeightBps }))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="plate__fallback">The model catalogue is unavailable right now; it is shown in full once you sign in.</p>
          )}
        </Plate>

        <Plate id="restatements" numeral="III" title="Corrected, never rewritten." figure={FIELD_GUIDE.clouds}>
          <p>
            A late dividend or a corrected close can change a number you already saw. We publish the corrected figure,
            keep the published one reachable, and show both — each with the date it was known.
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

        <Plate id="sandbox" numeral="IV" title="Sandbox, labelled as such." figure={FIELD_GUIDE.hills} flip>
          <p>
            This is a trial build on provider sandboxes. No real money moves, and every screen says so. Where an
            integration is unavailable, the product shows an honest unavailable state instead of a success it cannot
            prove.
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
          <h2 id="close-title">Begin with your name.</h2>
          <p className="entry__lead">
            Creating an account takes a minute and moves no money. Verification, bank linking and funding follow — in that
            order, and only when you choose.
          </p>
          <div className="entry__actions">
            <Link href="/sign-up" className="button" data-variant="primary">
              <span className="button__label">Create an account</span>
            </Link>
            <Link href="/sign-in" className="text-link entry__secondary">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing__footer">
        <Brand />
        <nav aria-label="Footer">
          {LANDING_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up">Create an account</Link>
        </nav>
        <p className="muted">
          Corgi Invest · work-trial build. Sandbox providers only; nothing on this site is an offer, a recommendation, or
          a promise of any outcome.
        </p>
      </footer>
    </div>
  );
}

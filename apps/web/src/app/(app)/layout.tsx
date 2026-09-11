import { EnvironmentBadge, StatusPill } from "@corgi/ui";
import { Brand } from "../../components/Brand";
import { OnboardingNotice } from "../../components/OnboardingNotice";
import { ShellNav } from "../../components/ShellNav";
import { kycTone, kycLabel } from "../../lib/copy";
import { onboardingNotice } from "../../lib/onboarding-notice";
import { signOutAction } from "../../server/actions";
import { load, requireApi } from "../../server/api";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await requireApi();
  const [me, onboarding] = await Promise.all([load(() => api.me()), load(() => api.onboarding())]);
  // The rail is server truth; when it cannot be loaded the shell shows nothing rather than guessing.
  const notice = onboarding.data ? onboardingNotice(onboarding.data) : null;

  return (
    <div className="shell">
      <aside className="shell__side">
        <Brand href="/overview" />
        <ShellNav variant="side" attention={notice ? "/onboarding" : null} />
        <div className="shell__account">
          {me.data ? (
            <>
              <strong>{me.data.customer.displayName}</strong>
              <StatusPill tone={kycTone(me.data.customer.kycStatus)}>{kycLabel(me.data.customer.kycStatus)}</StatusPill>
            </>
          ) : null}
          <form action={signOutAction}>
            <button type="submit" className="text-link">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="shell__main">
        <header className="shell__top">
          <span className="shell__breadcrumb">{me.data ? me.data.customer.email : "Signed in"}</span>
          <EnvironmentBadge environment={me.data?.environment ?? "sandbox"} />
        </header>
        {notice ? <OnboardingNotice notice={notice} /> : null}
        <main className="shell__content">{children}</main>
      </div>
      <ShellNav variant="bottom" attention={notice ? "/onboarding" : null} />
    </div>
  );
}

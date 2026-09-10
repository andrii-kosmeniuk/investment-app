import { EnvironmentBadge, StatusPill } from "@corgi/ui";
import { Brand } from "../../components/Brand";
import { ShellNav } from "../../components/ShellNav";
import { kycTone, kycLabel } from "../../lib/copy";
import { signOutAction } from "../../server/actions";
import { load, requireApi } from "../../server/api";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await requireApi();
  const me = await load(() => api.me());

  return (
    <div className="shell">
      <aside className="shell__side">
        <Brand href="/overview" />
        <ShellNav variant="side" />
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
        <main className="shell__content">{children}</main>
      </div>
      <ShellNav variant="bottom" />
    </div>
  );
}

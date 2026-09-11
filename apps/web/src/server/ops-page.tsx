import type { OperatorResponse } from "@corgi/contracts";
import type { ReactNode } from "react";
import { OperatorSignIn } from "../components/OperatorSignIn";
import { OpsAccount } from "../components/OpsAccount";
import { OpsShell } from "../components/OpsShell";
import type { ApiClient } from "./api-client";
import { opsApi, readOperatorId } from "./ops-session";

export interface OpsContext {
  readonly api: ApiClient;
  readonly operatorId: string | null;
  readonly operators: readonly OperatorResponse[];
}

/** Session, acting operator and the operator list every console page needs; null when signed out. */
export async function opsContext(): Promise<OpsContext | null> {
  const api = await opsApi();
  if (!api) return null;
  const operatorId = await readOperatorId();
  let operators: readonly OperatorResponse[] = [];
  try {
    operators = (await api.operators()).operators;
  } catch {
    // A rejected token renders the sign-in form via the page's own load; keep the shell usable.
  }
  return { api, operatorId, operators };
}

/** The signed-out variant of any console page: same chrome, token form instead of data. */
export function OpsSignedOut({ current, title }: { readonly current: string; readonly title: string }) {
  return (
    <OpsShell current={current}>
      <header>
        <div>
          <h1>{title}</h1>
          <p>Operator token required.</p>
        </div>
      </header>
      <OperatorSignIn />
    </OpsShell>
  );
}

export function OpsPage({ context, current, children }: { readonly context: OpsContext; readonly current: string; readonly children: ReactNode }) {
  return (
    <OpsShell current={current} account={<OpsAccount operators={context.operators} operatorId={context.operatorId} />}>
      {children}
    </OpsShell>
  );
}

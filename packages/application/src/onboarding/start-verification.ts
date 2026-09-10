import { NotFoundError, NotPermittedError } from "../errors.js";
import type {
  Clock,
  CustomerRepository,
  IdentityInquiryRepository,
  IdentityPort,
} from "../ports.js";

export interface StartVerificationDeps {
  readonly customers: CustomerRepository;
  readonly inquiries: IdentityInquiryRepository;
  readonly identity: IdentityPort;
  readonly clock: Clock;
}

export interface VerificationSession {
  readonly inquiryId: string;
  readonly sessionToken: string;
}

/**
 * Starts or resumes the customer's identity check. An open inquiry is resumed
 * rather than duplicated; an approved customer has nothing to verify. Only the
 * provider's outcome (via `applyInquiryStatus`) can move KYC past `pending`.
 */
export async function startVerification(
  deps: StartVerificationDeps,
  customerId: string,
): Promise<VerificationSession> {
  const customer = await deps.customers.findById(customerId);
  if (!customer) throw new NotFoundError(`unknown customer: ${customerId}`);
  if (customer.kycStatus === "approved") {
    throw new NotPermittedError("Identity is already verified");
  }

  const latest = await deps.inquiries.latestForCustomer(customerId);
  if (latest && (latest.status === "pending" || latest.status === "needs_review")) {
    const resumed = await deps.identity.resumeInquiry(latest.inquiryId);
    return { inquiryId: latest.inquiryId, sessionToken: resumed.sessionToken };
  }

  const created = await deps.identity.createInquiry(customerId);
  await deps.inquiries.create({
    inquiryId: created.inquiryId,
    customerId,
    status: "pending",
    createdAt: deps.clock.now(),
  });
  await deps.customers.setKycStatus(customerId, "pending", true);
  return created;
}

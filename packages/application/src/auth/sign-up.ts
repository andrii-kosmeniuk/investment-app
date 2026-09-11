import { hashPassword } from "./credentials.js";
import { EmailTakenError, ValidationError } from "../errors.js";
import type { CustomerDirectory, CustomerProfile, CustomerRegistry, IdGenerator } from "../ports.js";

export interface SignUpDeps {
  readonly directory: CustomerDirectory;
  readonly registry: CustomerRegistry;
  readonly ids: IdGenerator;
  readonly hash?: (password: string) => Promise<string>;
}

export interface SignUpCommand {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Registers a customer who can sign in but not yet move money: the profile
 * starts at `kyc_status = not_started` with trading blocked, and only Persona's
 * decision (via the webhook) lifts that (ADR-0006). The email is normalised the
 * same way `signIn` does, so a customer signs in with what they typed here.
 */
export async function signUp(deps: SignUpDeps, command: SignUpCommand): Promise<CustomerProfile> {
  const email = command.email.trim().toLowerCase();
  const displayName = command.displayName.trim().replace(/\s+/g, " ");
  if (displayName.length < 2) throw new ValidationError("Tell us what to call you (at least 2 characters)");
  if (command.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (await deps.directory.findProfileByEmail(email)) {
    throw new EmailTakenError("An account with this email already exists");
  }
  const passwordHash = await (deps.hash ?? hashPassword)(command.password);
  return deps.registry.create({ id: deps.ids.next(), email, displayName, passwordHash });
}

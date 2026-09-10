import { verifyPassword } from "./credentials.js";
import type { CredentialsRepository, CustomerDirectory, CustomerProfile } from "../ports.js";

export interface SignInDeps {
  readonly directory: CustomerDirectory;
  readonly credentials: CredentialsRepository;
  readonly verify?: (password: string, storedHash: string) => Promise<boolean>;
}

export interface SignInCommand {
  readonly email: string;
  readonly password: string;
}

// Verified against when the email is unknown or has no credential, so a failed
// sign-in costs the same work either way and does not leak account existence.
const DECOY_HASH =
  "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Returns the profile on success, null on any failure. Never says why. */
export async function signIn(deps: SignInDeps, command: SignInCommand): Promise<CustomerProfile | null> {
  const verify = deps.verify ?? verifyPassword;
  const profile = await deps.directory.findProfileByEmail(command.email.trim().toLowerCase());
  const storedHash = profile ? await deps.credentials.findPasswordHash(profile.id) : null;
  const valid = await verify(command.password, storedHash ?? DECOY_HASH);
  return valid && profile && storedHash ? profile : null;
}

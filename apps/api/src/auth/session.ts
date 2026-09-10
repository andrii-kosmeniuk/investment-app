import { SignJWT, jwtVerify } from "jose";

export interface SessionClaims {
  readonly customerId: string;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionTokens {
  issue(claims: SessionClaims, now?: Date): Promise<IssuedSession>;
  verify(token: string, now?: Date): Promise<SessionClaims | null>;
}

const AUDIENCE = "corgi-invest:customer";
const ISSUER = "corgi-invest:api";

/**
 * Stateless, HMAC-signed session tokens. The API is the only party that mints
 * or checks them; the web app just stores the opaque string in an httpOnly
 * cookie and forwards it as a bearer. No session table, nothing to revoke
 * individually — acceptable for a 12-hour TTL in a trial build.
 */
export function createSessionTokens(options: { secret: string; ttlSeconds: number }): SessionTokens {
  const key = new TextEncoder().encode(options.secret);
  return {
    async issue(claims, now = new Date()) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      const expiresAtSeconds = issuedAt + options.ttlSeconds;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(claims.customerId)
        .setAudience(AUDIENCE)
        .setIssuer(ISSUER)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAtSeconds)
        .sign(key);
      return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
    },
    async verify(token, now = new Date()) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          audience: AUDIENCE,
          issuer: ISSUER,
          currentDate: now,
        });
        return payload.sub ? { customerId: payload.sub } : null;
      } catch {
        return null;
      }
    },
  };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

import type { InboxEvent, InboxRepository } from "@corgi/application";
import { and, eq, notExists, sql } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { inboundEventAttempts, inboundEvents } from "../schema.js";

type EventRow = typeof inboundEvents.$inferSelect;

function toInboxEvent(row: EventRow): InboxEvent {
  return {
    provider: row.provider,
    externalId: row.externalId,
    dedupeKey: row.dedupeKey,
    type: row.eventType,
    payload: row.payload,
    signatureValid: row.signatureValid,
    receivedAt: row.receivedAt,
  };
}

/**
 * Idempotent inbox for webhooks and SSE. Ingress dedupes on `dedupeKey`
 * (ON CONFLICT DO NOTHING); delivery status is an append-only trail of
 * attempts, so an event is re-leased until an attempt records `processed`.
 */
export class DrizzleInboxRepository implements InboxRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async receive(event: InboxEvent): Promise<"inserted" | "duplicate"> {
    const inserted = await this.db
      .insert(inboundEvents)
      .values({
        provider: event.provider,
        externalId: event.externalId,
        dedupeKey: event.dedupeKey,
        eventType: event.type,
        payload: event.payload,
        signatureValid: event.signatureValid,
        receivedAt: event.receivedAt,
      })
      .onConflictDoNothing({ target: inboundEvents.dedupeKey })
      .returning({ id: inboundEvents.id });
    return inserted.length === 0 ? "duplicate" : "inserted";
  }

  async leaseBatch(limit: number): Promise<readonly InboxEvent[]> {
    const rows = await this.db
      .select()
      .from(inboundEvents)
      .where(
        notExists(
          this.db
            .select({ one: sql`1` })
            .from(inboundEventAttempts)
            .where(
              and(
                eq(inboundEventAttempts.eventId, inboundEvents.id),
                eq(inboundEventAttempts.status, "processed"),
              ),
            ),
        ),
      )
      .orderBy(inboundEvents.receivedAt)
      .limit(limit);
    return rows.map(toInboxEvent);
  }

  markProcessed(dedupeKey: string): Promise<void> {
    return this.recordAttempt(dedupeKey, "processed");
  }

  markFailed(dedupeKey: string, error: string): Promise<void> {
    return this.recordAttempt(dedupeKey, "failed", error);
  }

  private async recordAttempt(
    dedupeKey: string,
    status: "processed" | "failed",
    error?: string,
  ): Promise<void> {
    const [event] = await this.db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(eq(inboundEvents.dedupeKey, dedupeKey))
      .limit(1);
    if (!event) throw new Error(`unknown inbound event: ${dedupeKey}`);

    const [counted] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboundEventAttempts)
      .where(eq(inboundEventAttempts.eventId, event.id));
    const attempt = (counted?.count ?? 0) + 1;
    const now = new Date();

    await this.db.insert(inboundEventAttempts).values({
      eventId: event.id,
      attempt,
      status,
      error: error ?? null,
      startedAt: now,
      finishedAt: now,
    });
  }
}

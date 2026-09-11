ALTER TABLE "custodian_files" ADD COLUMN "content" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD COLUMN "broker_value" text;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD COLUMN "resolved_by_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "amount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "side" text DEFAULT 'buy' NOT NULL;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_resolved_by_actor_id_actors_id_fk" FOREIGN KEY ("resolved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recon_breaks_open_identity_uq" ON "recon_breaks" USING btree ("customer_id","category","key") WHERE "recon_breaks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "settlements_due_idx" ON "settlements" USING btree ("status","contractual_settlement_date");--> statement-breakpoint
-- Automated requests (e.g. sell-to-cover after a returned deposit) need a requester the maker-checker trigger can see (ADR-0005).
INSERT INTO "actors" ("email", "display_name", "role", "actor_type") VALUES ('system@demo.corgi', 'Corgi System', 'system', 'agent') ON CONFLICT ("email") DO NOTHING;

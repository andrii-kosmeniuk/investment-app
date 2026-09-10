DROP INDEX "period_returns_version_uq";--> statement-breakpoint
ALTER TABLE "period_returns" ADD COLUMN "period" text DEFAULT 'inception' NOT NULL;--> statement-breakpoint
ALTER TABLE "valuations" ADD COLUMN "status" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
CREATE INDEX "period_returns_customer_end_idx" ON "period_returns" USING btree ("customer_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "period_returns_version_uq" ON "period_returns" USING btree ("customer_id","period","period_end","version");--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_status_chk" CHECK ("status" IN ('final', 'provisional'));--> statement-breakpoint
ALTER TABLE "period_returns" ADD CONSTRAINT "period_returns_period_chk" CHECK ("period" IN ('mtd', 'ytd', 'inception'));--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_status_chk" CHECK ("status" IN ('final', 'stale', 'missing'));

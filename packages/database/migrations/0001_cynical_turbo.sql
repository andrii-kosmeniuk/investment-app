CREATE TABLE "inbound_event_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "inbound_events_lease_idx";--> statement-breakpoint
ALTER TABLE "inbound_event_attempts" ADD CONSTRAINT "inbound_event_attempts_event_id_inbound_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inbound_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_event_attempts_number_uq" ON "inbound_event_attempts" USING btree ("event_id","attempt");--> statement-breakpoint
CREATE INDEX "inbound_event_attempts_status_idx" ON "inbound_event_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "inbound_events_received_idx" ON "inbound_events" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "inbound_events" DROP COLUMN "processed_at";--> statement-breakpoint
ALTER TABLE "inbound_events" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "inbound_events" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "inbound_events" DROP COLUMN "attempts";
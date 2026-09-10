CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_provider" AS ENUM('alpaca', 'plaid', 'persona', 'custodian');--> statement-breakpoint
CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"actor_type" "actor_type" DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actors_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"decided_by_actor_id" uuid NOT NULL,
	"decided_by_actor_type" "actor_type" NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_human_only" CHECK ("approval_decisions"."decided_by_actor_type" = 'human')
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by_actor_id" uuid NOT NULL,
	"requested_by_actor_type" "actor_type" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"account_mask" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custodian_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"source" text DEFAULT 'simulator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"broker_account_id" text NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"kyc_status" text DEFAULT 'not_started' NOT NULL,
	"trading_blocked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "identity_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_inquiry_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "event_provider" NOT NULL,
	"external_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"reverses_entry_id" uuid,
	"description" text NOT NULL,
	"previous_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"commodity_constraint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ratio_numerator" bigint NOT NULL,
	"ratio_denominator" bigint NOT NULL,
	"units_after" bigint NOT NULL,
	"basis_per_unit_after" numeric(28, 12) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"sell_entry_id" uuid NOT NULL,
	"units_micro" bigint NOT NULL,
	"proceeds_cents" bigint NOT NULL,
	"basis_cents" bigint NOT NULL,
	"realized_cents" bigint NOT NULL,
	"term" text NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"target_weight_bps" integer NOT NULL,
	"minimum_trade_cents" bigint DEFAULT 100 NOT NULL,
	"fractional_allowed" boolean DEFAULT true NOT NULL,
	CONSTRAINT "model_allocations_weight_range" CHECK ("model_allocations"."target_weight_bps" >= 0 AND "model_allocations"."target_weight_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "model_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"risk_level" integer NOT NULL,
	"cash_buffer_bps" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_portfolios_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider_order_id" text,
	"client_order_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"requested_notional_cents" bigint,
	"requested_units_micro" bigint,
	"cumulative_filled_units_micro" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"twr_bps_e4" bigint NOT NULL,
	"mwr_bps_e4" bigint,
	"flows_cents" bigint NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"commodity" text NOT NULL,
	"quantity" bigint NOT NULL,
	"lot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"trade_date" date NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"source" text NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_states" (
	"provider" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"circuit_open_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rebalance_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"notional_cents" bigint NOT NULL,
	"target_weight_bps" integer NOT NULL,
	"current_weight_bps" integer NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rebalance_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"status" text NOT NULL,
	"total_notional_cents" bigint NOT NULL,
	"generated_by_actor_id" uuid NOT NULL,
	"generated_by_actor_type" "actor_type" NOT NULL,
	"as_of_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_run_id" uuid NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"ledger_value" text NOT NULL,
	"custodian_value" text NOT NULL,
	"delta" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text NOT NULL,
	"ledger_snapshot_hash" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"fill_external_id" text NOT NULL,
	"trade_date" date NOT NULL,
	"contractual_settlement_date" date NOT NULL,
	"status" text NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"opened_entry_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"units_micro" bigint NOT NULL,
	"basis_cents" bigint NOT NULL,
	"method" text DEFAULT 'fifo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"provider_transfer_id" text NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"return_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"value_cents" bigint NOT NULL,
	"cash_cents" bigint NOT NULL,
	"positions" jsonb NOT NULL,
	"price_set_hash" text NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_actor_id_actors_id_fk" FOREIGN KEY ("decided_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portfolios" ADD CONSTRAINT "customer_portfolios_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portfolios" ADD CONSTRAINT "customer_portfolios_model_id_model_portfolios_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_inquiries" ADD CONSTRAINT "identity_inquiries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_adjustments" ADD CONSTRAINT "lot_adjustments_lot_id_tax_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."tax_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_adjustments" ADD CONSTRAINT "lot_adjustments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_id_tax_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."tax_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_sell_entry_id_journal_entries_id_fk" FOREIGN KEY ("sell_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_allocations" ADD CONSTRAINT "model_allocations_model_id_model_portfolios_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_returns" ADD CONSTRAINT "period_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebalance_legs" ADD CONSTRAINT "rebalance_legs_proposal_id_rebalance_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."rebalance_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebalance_legs" ADD CONSTRAINT "rebalance_legs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebalance_proposals" ADD CONSTRAINT "rebalance_proposals_portfolio_id_customer_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."customer_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebalance_proposals" ADD CONSTRAINT "rebalance_proposals_model_id_model_portfolios_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rebalance_proposals" ADD CONSTRAINT "rebalance_proposals_generated_by_actor_id_actors_id_fk" FOREIGN KEY ("generated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_first_run_id_recon_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_last_seen_run_id_recon_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_resolution_entry_id_journal_entries_id_fk" FOREIGN KEY ("resolution_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_file_id_custodian_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."custodian_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_opened_entry_id_journal_entries_id_fk" FOREIGN KEY ("opened_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_provider_uq" ON "bank_accounts" USING btree ("provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_portfolios_customer_uq" ON "customer_portfolios" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_inquiries_provider_uq" ON "identity_inquiries" USING btree ("provider_inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_dedupe_uq" ON "inbound_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "inbound_events_lease_idx" ON "inbound_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_idempotency_uq" ON "journal_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "journal_entries_bitemporal_idx" ON "journal_entries" USING btree ("effective_at","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_path_uq" ON "ledger_accounts" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "model_allocations_symbol_uq" ON "model_allocations" USING btree ("model_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "order_events_external_uq" ON "order_events" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_order_uq" ON "orders" USING btree ("client_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_order_uq" ON "orders" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "period_returns_version_uq" ON "period_returns" USING btree ("customer_id","period_start","period_end","version");--> statement-breakpoint
CREATE INDEX "postings_entry_idx" ON "postings" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "postings_account_commodity_idx" ON "postings" USING btree ("account_id","commodity");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_symbol_date_version_uq" ON "prices" USING btree ("symbol","trade_date","version");--> statement-breakpoint
CREATE INDEX "recon_breaks_status_age_idx" ON "recon_breaks" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_fill_uq" ON "settlements" USING btree ("fill_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_provider_uq" ON "transfers" USING btree ("provider_transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "valuations_customer_date_version_uq" ON "valuations" USING btree ("customer_id","as_of_date","version");
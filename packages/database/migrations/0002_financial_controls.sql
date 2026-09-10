CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % does not allow %', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'journal_entries', 'postings', 'inbound_events', 'inbound_event_attempts',
    'order_events', 'tax_lots', 'lot_consumptions', 'lot_adjustments',
    'prices', 'valuations', 'period_returns', 'approval_decisions'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION reject_mutation()',
      table_name, table_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_entry_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unbalanced record;
BEGIN
  SELECT commodity, SUM(quantity) AS balance INTO unbalanced
    FROM postings WHERE entry_id = NEW.entry_id
   GROUP BY commodity HAVING SUM(quantity) <> 0 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'journal entry % does not balance for %: %',
      NEW.entry_id, unbalanced.commodity, unbalanced.balance;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER postings_balance_deferred
AFTER INSERT ON postings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_self_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maker uuid;
BEGIN
  SELECT requested_by_actor_id INTO maker FROM approval_requests WHERE id = NEW.request_id;
  IF maker = NEW.decided_by_actor_id THEN
    RAISE EXCEPTION 'initiator cannot decide their own approval request';
  END IF;
  IF NEW.decided_by_actor_type <> 'human' THEN
    RAISE EXCEPTION 'autonomous agents cannot decide approval requests';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_maker_checker
BEFORE INSERT ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION reject_self_approval();
--> statement-breakpoint
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_reversal_fk
  FOREIGN KEY (reverses_entry_id) REFERENCES journal_entries(id);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corgi_app') THEN
    REVOKE UPDATE, DELETE ON journal_entries, postings, inbound_events,
      inbound_event_attempts, order_events, tax_lots, lot_consumptions,
      lot_adjustments, prices, valuations, period_returns, approval_decisions
      FROM corgi_app;
  END IF;
END;
$$;

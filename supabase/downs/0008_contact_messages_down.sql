-- BIBO Bay down script for migration 0008 (the contact form; rulings R191, R201-R207).
--
-- EMERGENCIES ONLY. The normal rollback of the contact form is a code revert: revert the merge commit
-- of PR #8 on main and push (docs/deployment.md, "Contact form: rollback"). The next deployment closes
-- the form and removes /contact; the two tables stay, additive and unused, because nothing reads or
-- writes them without that code. Run this script only when the schema itself has to go.
--
-- DATA LOSS: this script DELETES every stored contact message and every alert row, for good. Nothing
-- but a database backup brings them back. Read and answer any message that still needs a reply first
-- (docs/incident-runbook.md, "Contact messages").
--
-- What it removes, and nothing else (it is the inverse of 0008, which adds no type, trigger, policy,
-- sequence or view and changes no earlier object):
--
--   * the functions submit_contact_message(text, text, text, text),
--     claim_contact_deliveries(integer, uuid) and record_contact_delivery_attempt(uuid, text, text,
--     text), with their grants;
--   * the indexes contact_message_deliveries_due_idx and contact_messages_created_at_idx;
--   * the table contact_message_deliveries (the contact outbox), then contact_messages, with their
--     grants, row level security, primary keys, check constraints, the foreign key and the unique key
--     contact_message_deliveries_message_kind_key.
--
-- No lead, order, staff, rate-limit or outbox object of 0001-0007 is touched; the rate-limit buckets
-- `contact:*` and `send:contact_staff_alert` are rows that expire on their own. Every drop is
-- `if exists` (a second run changes nothing) and none cascades: if anything else depends on a contact
-- table, the script stops and, in one transaction, drops nothing.
--
-- This is not a migration. It lives in supabase/downs/, which `supabase db push` never reads (it
-- applies supabase/migrations/ only) and the test harness never applies as a migration. Run it from
-- the repository root, with the CLI linked to the project, as the project owner:
--
--   npx supabase@2.121.0 db query --linked -f supabase/downs/0008_contact_messages_down.sql
--
-- The migration history still lists 0008 afterwards, so `supabase db push` would not apply it again.
-- To bring the contact schema back later, mark it reverted, then push:
--
--   npx supabase@2.121.0 migration repair 0008 --status reverted --linked
--
-- Tests: tests/contact/migration-rollback.test.ts (0001-0007, 0008, this script, 0008 again, in an
-- embedded Postgres).

begin;

drop function if exists public.submit_contact_message(text, text, text, text);
drop function if exists public.claim_contact_deliveries(integer, uuid);
drop function if exists public.record_contact_delivery_attempt(uuid, text, text, text);

drop index if exists public.contact_message_deliveries_due_idx;
drop index if exists public.contact_messages_created_at_idx;

-- The outbox first: its foreign key references contact_messages.
drop table if exists public.contact_message_deliveries;
drop table if exists public.contact_messages;

commit;

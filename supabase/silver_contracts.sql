-- silver_contracts already exists. Add cleaned fields and join keys only.
-- Inserts send PostgreSQL types: uuid, text, date (YYYY-MM-DD), numeric, jsonb.
alter table public.silver_contracts
  add column if not exists wedding_id uuid,
  add column if not exists bronze_payload_id uuid,
  add column if not exists vendor_id uuid,
  add column if not exists vendor_name text,
  add column if not exists vendor_type text,
  add column if not exists contract_type text,
  add column if not exists client_name text,
  add column if not exists event_date date,
  add column if not exists grand_total numeric,
  add column if not exists payment_milestones jsonb default '[]'::jsonb;

create index if not exists silver_contracts_wedding_id_idx
  on public.silver_contracts (wedding_id);

create index if not exists silver_contracts_bronze_payload_id_idx
  on public.silver_contracts (bronze_payload_id);

create index if not exists silver_contracts_vendor_id_idx
  on public.silver_contracts (vendor_id);

-- Cleaned contract fields plus join keys for other silver tables.
create table if not exists public.silver_contracts (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid,
  bronze_payload_id uuid references public.bronze_contract_raw_payloads (id),
  vendor_id uuid,
  vendor_type text,
  client_name text,
  event_date text,
  payment_milestones jsonb not null default '[]'::jsonb,
  key_questionnaire_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.silver_contracts
  add column if not exists wedding_id uuid,
  add column if not exists bronze_payload_id uuid,
  add column if not exists vendor_id uuid,
  add column if not exists vendor_type text,
  add column if not exists client_name text,
  add column if not exists event_date text,
  add column if not exists payment_milestones jsonb default '[]'::jsonb,
  add column if not exists key_questionnaire_items jsonb default '[]'::jsonb;

create index if not exists silver_contracts_wedding_id_idx
  on public.silver_contracts (wedding_id);

create index if not exists silver_contracts_bronze_payload_id_idx
  on public.silver_contracts (bronze_payload_id);

create index if not exists silver_contracts_vendor_id_idx
  on public.silver_contracts (vendor_id);

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

grant usage on schema public to anon, authenticated;

grant select, insert, update on public.silver_contracts to anon, authenticated;

alter table public.silver_contracts enable row level security;

drop policy if exists silver_contracts_select_anon on public.silver_contracts;
create policy silver_contracts_select_anon
  on public.silver_contracts
  for select
  to anon, authenticated
  using (true);

drop policy if exists silver_contracts_insert_anon on public.silver_contracts;
create policy silver_contracts_insert_anon
  on public.silver_contracts
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists silver_contracts_update_anon on public.silver_contracts;
create policy silver_contracts_update_anon
  on public.silver_contracts
  for update
  to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';

-- bronze_contract_raw_payloads already exists. Add the columns the parser writes.
alter table public.bronze_contract_raw_payloads
  add column if not exists file_name text,
  add column if not exists raw_text text,
  add column if not exists status text,
  add column if not exists vendor_type text;

notify pgrst, 'reload schema';

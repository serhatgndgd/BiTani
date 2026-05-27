create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  consent_type text not null,
  consent_given boolean not null,
  version text not null default 'v1.0',
  given_at timestamp default now()
);

create index if not exists idx_consent_user on public.consent_records(user_id);

alter table public.consent_records enable row level security;

create policy "own_consents" on public.consent_records
  for all using (auth.uid() = user_id);

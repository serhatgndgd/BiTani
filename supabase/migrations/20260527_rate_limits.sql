create table if not exists public.rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_count int not null default 0,
  window_start timestamp not null default now()
);

alter table public.rate_limits enable row level security;

create policy if not exists "Users can read own rate limits"
  on public.rate_limits
  for select
  using (auth.uid() = user_id);

create policy if not exists "Service role can manage rate limits"
  on public.rate_limits
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

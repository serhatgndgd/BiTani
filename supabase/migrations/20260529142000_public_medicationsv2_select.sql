-- medicationsV2 is the active public medication catalog used by the mobile app.
-- The table name is mixed-case, so keep it quoted in all policy/grant statements.

alter table public."medicationsV2" enable row level security;

drop policy if exists "Public can read medicationsV2" on public."medicationsV2";

create policy "Public can read medicationsV2"
  on public."medicationsV2"
  for select
  to anon, authenticated
  using (true);

grant select on public."medicationsV2" to anon, authenticated;

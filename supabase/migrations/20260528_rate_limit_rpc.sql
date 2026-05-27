-- Atomik rate limit fonksiyonu
-- INSERT ... ON CONFLICT DO UPDATE tek SQL operasyonunda hem sıfırlama
-- hem de artırma yapar — race condition'ı ortadan kaldırır.
create or replace function public.increment_rate_limit(
  p_user_id       uuid,
  p_window_seconds int  default 60,
  p_max_requests   int  default 10
)
returns table(allowed boolean, request_count int, window_start timestamp)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.rate_limits (user_id, request_count, window_start)
  values (p_user_id, 1, now()::timestamp)
  on conflict (user_id) do update
  set
    request_count = case
      when public.rate_limits.window_start
             < now()::timestamp - (p_window_seconds || ' seconds')::interval
      then 1
      else public.rate_limits.request_count + 1
    end,
    window_start = case
      when public.rate_limits.window_start
             < now()::timestamp - (p_window_seconds || ' seconds')::interval
      then now()::timestamp
      else public.rate_limits.window_start
    end
  returning
    (public.rate_limits.request_count <= p_max_requests)::boolean as allowed,
    public.rate_limits.request_count::int                         as request_count,
    public.rate_limits.window_start                               as window_start;
end;
$$;

grant execute on function public.increment_rate_limit(uuid, int, int) to service_role;

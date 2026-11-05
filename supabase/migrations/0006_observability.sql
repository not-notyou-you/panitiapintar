-- 0006_observability: read paths for /admin/logs (ROADMAP 4.1–4.2). No table or policy changes.

-- Indexes for the log pages' filters.
create index if not exists ai_calls_purpose_time_idx on ai_calls(purpose, occurred_at desc);
create index if not exists audit_logs_outcome_time_idx on audit_logs(outcome, occurred_at desc);
create index if not exists chat_logs_unanswered_idx on chat_logs(committee_id, created_at desc) where answered = false;

-- rate_limits has no policies (service role only). The Keamanan tab needs recent busy windows, so this
-- SECURITY DEFINER function exposes them to super admins only. Bucket keys hold an IP hash or user id,
-- never raw identifiers. Rows older than 2 days are purged by purge_expired_logs.
create or replace function security_rate_limit_windows(p_since timestamptz)
returns table(bucket text, window_start timestamptz, hits integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.bucket, r.window_start, r.hits
    from rate_limits r
    where r.window_start >= greatest(p_since, now() - interval '7 days')
      and r.hits > 5
    order by r.window_start desc
    limit 500;
end $$;
revoke all on function security_rate_limit_windows(timestamptz) from public, anon;
grant execute on function security_rate_limit_windows(timestamptz) to authenticated;

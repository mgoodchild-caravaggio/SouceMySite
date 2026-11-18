-- Matching step 4: Ask Hub, the AI assistant. Off until an admin adds an Anthropic API key.

------------------------------------------------------------------------------------------------
-- Settings everyone can read (is it on, the cap, the model). One row.
------------------------------------------------------------------------------------------------
create table public.ai_settings (
  id              boolean primary key default true check (id),
  enabled         boolean not null default false,
  monthly_cap_usd numeric(8, 2) not null default 50 check (monthly_cap_usd >= 0),
  model           text not null default 'claude-opus-5-5',
  -- Whether a key is stored, and its last 4 characters so admins can tell which one.
  key_set         boolean not null default false,
  key_hint        text not null default '',
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
insert into public.ai_settings (id) values (true);

alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon, authenticated;
grant select on public.ai_settings to authenticated;
create policy "Everyone can see the AI settings" on public.ai_settings for select to authenticated using (true);
-- Changes go through the ai-admin function, which checks the caller is an admin.

------------------------------------------------------------------------------------------------
-- The API key, encrypted with the server's TOKEN_KEY. No one can read this table from the browser.
------------------------------------------------------------------------------------------------
create table public.ai_secrets (
  id          boolean primary key default true check (id),
  api_key_enc text not null
);
alter table public.ai_secrets enable row level security;
revoke all on public.ai_secrets from anon, authenticated;

------------------------------------------------------------------------------------------------
-- One row per call to Claude: who, what they asked, tools used, tokens and cost. For the cap and audit.
------------------------------------------------------------------------------------------------
create table public.ai_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete set null,
  conversation_id    uuid,
  question           text not null default '',
  tools_used         text[] not null default '{}',
  model              text not null default '',
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  web_searches       int not null default 0,
  cost_usd           numeric(10, 5) not null default 0,
  error              text,
  created_at         timestamptz not null default now()
);
create index ai_requests_created_idx on public.ai_requests (created_at desc);

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon, authenticated;
grant select on public.ai_requests to authenticated;
create policy "People see their own questions; admins see all" on public.ai_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- This month's spend (Toronto calendar month), readable by everyone for the usage line in Settings.
create function public.ai_month_spend() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.ai_requests
  where created_at >= (date_trunc('month', now() at time zone 'America/Toronto') at time zone 'America/Toronto')
$$;
revoke execute on function public.ai_month_spend() from public, anon;
grant execute on function public.ai_month_spend() to authenticated;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.barometre_users (
  id text primary key,
  name text not null,
  role text not null check (role in ('admin','employee','extra')),
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barometre_login_guard (
  user_id text primary key references public.barometre_users(id) on delete cascade,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.barometre_sessions (
  token_hash text primary key,
  user_id text not null references public.barometre_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.barometre_audit_log (
  id bigint generated always as identity primary key,
  user_id text references public.barometre_users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.barometre_users (id,name,role,active)
values
  ('max','MAX','admin',true),
  ('charlotte','CHARLOTTE','admin',true),
  ('amaury','AMAURY','employee',true),
  ('extra1','EXTRA','extra',true)
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role,
  active = excluded.active,
  updated_at = now();

insert into public.barometre_login_guard (user_id)
select id from public.barometre_users
on conflict (user_id) do nothing;

alter table public.barometre_users enable row level security;
alter table public.barometre_login_guard enable row level security;
alter table public.barometre_sessions enable row level security;
alter table public.barometre_audit_log enable row level security;

revoke all on public.barometre_users from anon, authenticated;
revoke all on public.barometre_login_guard from anon, authenticated;
revoke all on public.barometre_sessions from anon, authenticated;
revoke all on public.barometre_audit_log from anon, authenticated;

create or replace function public.barometre_verify_pin(p_user_id text, p_pin text)
returns table(id text, name text, role text)
language sql
security definer
set search_path = public, extensions
as $$
  select u.id, u.name, u.role
  from public.barometre_users u
  where u.id = p_user_id
    and u.active = true
    and u.pin_hash is not null
    and u.pin_hash = crypt(p_pin, u.pin_hash)
  limit 1;
$$;

revoke all on function public.barometre_verify_pin(text,text) from public, anon, authenticated;
grant execute on function public.barometre_verify_pin(text,text) to service_role;

create or replace function public.barometre_set_pin(p_user_id text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits';
  end if;

  update public.barometre_users
  set pin_hash = crypt(p_pin, gen_salt('bf', 12)), updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Unknown user';
  end if;
end;
$$;

revoke all on function public.barometre_set_pin(text,text) from public, anon, authenticated;
grant execute on function public.barometre_set_pin(text,text) to service_role;

create index if not exists barometre_sessions_user_id_idx on public.barometre_sessions(user_id);
create index if not exists barometre_sessions_expires_at_idx on public.barometre_sessions(expires_at);
create index if not exists barometre_audit_log_created_at_idx on public.barometre_audit_log(created_at desc);

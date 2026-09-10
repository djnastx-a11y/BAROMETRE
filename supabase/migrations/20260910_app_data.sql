create table if not exists public.barometre_shifts (
  id text primary key,
  user_id text not null references public.barometre_users(id) on delete cascade,
  shift_date date not null,
  start_time time,
  end_time time,
  type text not null check (type in ('work','absence')),
  note text not null default '',
  created_by text references public.barometre_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barometre_stock (
  id text primary key,
  name text not null,
  category text not null default '',
  unit text not null default 'unités',
  qty numeric not null default 0 check (qty >= 0),
  min_qty numeric not null default 0 check (min_qty >= 0),
  supplier text not null default 'AUTRE',
  buy_price numeric not null default 0 check (buy_price >= 0),
  active boolean not null default true,
  created_by text references public.barometre_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barometre_requests (
  id text primary key,
  user_id text not null references public.barometre_users(id) on delete cascade,
  kind text not null,
  request_date date not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barometre_stock_log (
  id bigint generated always as identity primary key,
  product_id text not null references public.barometre_stock(id) on delete cascade,
  qty_before numeric not null,
  qty_after numeric not null,
  reason text not null,
  user_id text references public.barometre_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.barometre_shifts enable row level security;
alter table public.barometre_stock enable row level security;
alter table public.barometre_requests enable row level security;
alter table public.barometre_stock_log enable row level security;

revoke all on public.barometre_shifts from anon, authenticated;
revoke all on public.barometre_stock from anon, authenticated;
revoke all on public.barometre_requests from anon, authenticated;
revoke all on public.barometre_stock_log from anon, authenticated;

create index if not exists barometre_shifts_date_idx on public.barometre_shifts(shift_date);
create index if not exists barometre_shifts_user_date_idx on public.barometre_shifts(user_id, shift_date);
create index if not exists barometre_stock_active_idx on public.barometre_stock(active);
create index if not exists barometre_requests_user_date_idx on public.barometre_requests(user_id, request_date desc);
create index if not exists barometre_requests_status_idx on public.barometre_requests(status);
create index if not exists barometre_stock_log_product_created_idx on public.barometre_stock_log(product_id, created_at desc);

-- Civic Accord — Supabase database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

/* ------------------------------------------------------------------ */
/* 1. Resident accounts (private: no direct table access from the app) */
/* ------------------------------------------------------------------ */
create table if not exists public.residents (
  id          text primary key,
  name        text not null,
  mobile      text not null unique,
  email       text not null unique,
  address     text not null,
  city        text not null,
  pincode     text not null,
  pin_hash    text not null,              -- bcrypt hash, never the PIN itself
  created_at  timestamptz not null default now()
);
alter table public.residents enable row level security;
-- No policies on purpose: the app can only reach this table through the functions below.

create table if not exists public.login_attempts (
  mobile        text primary key,
  failed_count  integer not null default 0,
  locked_until  timestamptz
);
alter table public.login_attempts enable row level security;

create or replace function public.resident_json(r public.residents)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'id', r.id, 'name', r.name, 'mobile', r.mobile, 'email', r.email,
    'address', r.address, 'city', r.city, 'pincode', r.pincode,
    'createdAt', (extract(epoch from r.created_at) * 1000)::bigint
  );
$$;

create or replace function public.register_resident(
  p_name text, p_mobile text, p_email text, p_address text, p_city text, p_pincode text, p_pin text
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.residents;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your full name.'; end if;
  if coalesce(p_mobile, '') !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Enter a valid email address.'; end if;
  if length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Enter your house number and street.'; end if;
  if length(trim(coalesce(p_city, ''))) < 2 then raise exception 'Enter your city.'; end if;
  if coalesce(p_pincode, '') !~ '^[1-9][0-9]{5}$' then raise exception 'Enter a valid 6-digit PIN code.'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits.'; end if;
  if exists (select 1 from public.residents where mobile = p_mobile) then
    raise exception 'This mobile number is already registered. Sign in instead.';
  end if;
  if exists (select 1 from public.residents where email = v_email) then
    raise exception 'This email is already registered. Sign in instead.';
  end if;

  insert into public.residents (id, name, mobile, email, address, city, pincode, pin_hash)
  values ('r_' || p_mobile, regexp_replace(trim(p_name), '\s+', ' ', 'g'), p_mobile, v_email,
          trim(p_address), trim(p_city), p_pincode, crypt(p_pin, gen_salt('bf')))
  returning * into r;
  return public.resident_json(r);
end;
$$;

-- Returns the resident on a correct PIN, null on a wrong one.
-- After 5 wrong PINs the number is locked for 15 minutes (stops PIN guessing).
create or replace function public.verify_resident(p_mobile text, p_pin text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.residents;
  a public.login_attempts;
begin
  select * into a from public.login_attempts where mobile = p_mobile;
  if a.locked_until is not null and a.locked_until > now() then
    raise exception 'Too many wrong PINs. Try again in % minutes.',
      greatest(1, ceil(extract(epoch from (a.locked_until - now())) / 60))::int;
  end if;

  select * into r from public.residents where mobile = p_mobile;
  if r.id is not null and r.pin_hash = crypt(coalesce(p_pin, ''), r.pin_hash) then
    delete from public.login_attempts where mobile = p_mobile;
    return public.resident_json(r);
  end if;

  insert into public.login_attempts (mobile, failed_count) values (p_mobile, 1)
  on conflict (mobile) do update
    set failed_count = case when public.login_attempts.locked_until is not null
                             and public.login_attempts.locked_until <= now()
                            then 1 else public.login_attempts.failed_count + 1 end,
        locked_until = null;
  update public.login_attempts
    set locked_until = now() + interval '15 minutes', failed_count = 0
    where mobile = p_mobile and failed_count >= 5;
  return null;
end;
$$;

revoke all on function public.resident_json(public.residents) from public, anon, authenticated;
grant execute on function public.register_resident(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.verify_resident(text, text) to anon, authenticated;

-- Demo resident Riya (mobile 9876543210, PIN 1111). Synthetic data.
insert into public.residents (id, name, mobile, email, address, city, pincode, pin_hash, created_at)
values ('riya', 'Riya', '9876543210', 'riya.demo@gmail.com', 'House 42, Sector 14', 'Faridabad', '121007',
        extensions.crypt('1111', extensions.gen_salt('bf')), '2026-10-01T00:00:00Z')
on conflict (id) do nothing;

/* ------------------------------------------------------------------ */
/* 2. Audit ledger: append-only, hash-chained events                   */
/* ------------------------------------------------------------------ */
create table if not exists public.events (
  seq         integer primary key check (seq > 0),
  case_id     text   not null,
  type        text   not null,
  actor_id    text   not null,
  actor_name  text   not null,
  role        text   not null,
  at          bigint not null,
  data        jsonb  not null default '{}'::jsonb,
  prev_hash   text   not null,
  hash        text   not null,
  created_at  timestamptz not null default now()
);
alter table public.events enable row level security;

drop policy if exists "Anyone can read the ledger" on public.events;
create policy "Anyone can read the ledger" on public.events
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can append to the ledger" on public.events;
create policy "Anyone can append to the ledger" on public.events
  for insert to anon, authenticated with check (true);
-- No update or delete policies: entries can never be edited or removed from the app.

grant select, insert on public.events to anon, authenticated;

-- Server-side chain guard: each new entry must follow the last one exactly.
create or replace function public.events_chain_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  last_seq integer;
  last_hash text;
begin
  select seq, hash into last_seq, last_hash from public.events order by seq desc limit 1;
  if last_seq is null then
    if new.seq <> 1 or new.prev_hash <> repeat('0', 64) then
      raise exception 'Ledger must start at entry 1.' using errcode = '23505';
    end if;
  elsif new.seq <> last_seq + 1 or new.prev_hash <> last_hash then
    raise exception 'Ledger changed in the meantime: expected entry % after %.', last_seq + 1, last_seq
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists events_chain_guard on public.events;
create trigger events_chain_guard
  before insert on public.events
  for each row execute function public.events_chain_guard();

-- Live updates to every open screen
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- "Reset demo" button: wipes the ledger so the app re-creates the synthetic cases.
-- ⚠️ Anyone with the app can call this. Remove this function before real use.
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from public.events where true;
$$;
grant execute on function public.reset_demo() to anon, authenticated;

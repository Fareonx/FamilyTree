-- Family tree schema.
-- People are stored once; relationships are expressed through unions (couples)
-- and the children of each union, the same shape GEDCOM (INDI/FAM) uses.

create table public.app_users (
  email text primary key,
  role text not null default 'viewer' check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where email = lower(auth.jwt() ->> 'email'))
$$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where email = lower(auth.jwt() ->> 'email') and role = 'editor')
$$;

-- Dates are partial: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'.
create domain public.partial_date as text
  check (value is null or value ~ '^\d{4}(-\d{2}(-\d{2})?)?$');

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  maiden_name text,
  gender text not null default 'unknown' check (gender in ('male', 'female', 'unknown')),
  birth_date public.partial_date,
  birth_place text,
  death_date public.partial_date,
  is_deceased boolean not null default false,
  photo_path text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.unions (
  id uuid primary key default gen_random_uuid(),
  partner1_id uuid references public.persons (id) on delete set null,
  partner2_id uuid references public.persons (id) on delete set null,
  kind text not null default 'married' check (kind in ('married', 'divorced', 'partner', 'unknown')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (partner1_id is null or partner2_id is null or partner1_id <> partner2_id)
);
create index unions_partner1_idx on public.unions (partner1_id);
create index unions_partner2_idx on public.unions (partner2_id);

create table public.union_children (
  union_id uuid not null references public.unions (id) on delete cascade,
  child_id uuid not null references public.persons (id) on delete cascade,
  relation text not null default 'biological' check (relation in ('biological', 'adopted', 'step', 'foster')),
  sort_order integer not null default 0,
  primary key (union_id, child_id)
);
create index union_children_child_idx on public.union_children (child_id);

create table public.settings (
  key text primary key,
  value jsonb not null
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end
$$;
create trigger persons_touch before update on public.persons
  for each row execute function public.touch_updated_at();

alter table public.app_users enable row level security;
alter table public.persons enable row level security;
alter table public.unions enable row level security;
alter table public.union_children enable row level security;
alter table public.settings enable row level security;

create policy "own membership" on public.app_users for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

create policy "members read" on public.persons for select to authenticated using ((select public.is_member()));
create policy "editors insert" on public.persons for insert to authenticated with check ((select public.is_editor()));
create policy "editors update" on public.persons for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors delete" on public.persons for delete to authenticated using ((select public.is_editor()));

create policy "members read" on public.unions for select to authenticated using ((select public.is_member()));
create policy "editors insert" on public.unions for insert to authenticated with check ((select public.is_editor()));
create policy "editors update" on public.unions for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors delete" on public.unions for delete to authenticated using ((select public.is_editor()));

create policy "members read" on public.union_children for select to authenticated using ((select public.is_member()));
create policy "editors insert" on public.union_children for insert to authenticated with check ((select public.is_editor()));
create policy "editors update" on public.union_children for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors delete" on public.union_children for delete to authenticated using ((select public.is_editor()));

create policy "members read" on public.settings for select to authenticated using ((select public.is_member()));
create policy "editors insert" on public.settings for insert to authenticated with check ((select public.is_editor()));
create policy "editors update" on public.settings for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()));
create policy "editors delete" on public.settings for delete to authenticated using ((select public.is_editor()));

-- Private bucket for portraits; the app reads them through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select public.is_member()));
create policy "editors upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select public.is_editor()));
create policy "editors update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select public.is_editor()));
create policy "editors delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select public.is_editor()));

revoke execute on function public.is_member() from anon;
revoke execute on function public.is_editor() from anon;

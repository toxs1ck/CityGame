-- Profiles table: extends auth.users with app-specific data
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text,
  is_gm      boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Users can read their own profile
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- Users can update their own profile (username only; is_gm requires admin)
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grant GM status: run this manually in Supabase SQL editor per user
-- update profiles set is_gm = true where id = '<user-uuid>';

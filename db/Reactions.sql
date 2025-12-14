-- Reactions System 

-- 1. Reactions Table
create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('like', 'repost', 'bookmark')), -- Renamed 'save' to 'bookmark'
  
  created_at timestamp with time zone default now(),
  
  -- One reaction of each type per user per post
  unique(post_id, user_id, type)
);

-- 2. RLS Policies
alter table public.reactions enable row level security;

create policy "Reactions are viewable by everyone"
  on public.reactions for select using (true);

create policy "Users can react"
  on public.reactions for insert
  with check (auth.uid() = user_id);

create policy "Users can un-react"
  on public.reactions for delete
  using (auth.uid() = user_id);

-- 3. Optimization Indexes
create index if not exists reactions_post_idx on public.reactions(post_id);
create index if not exists reactions_user_idx on public.reactions(user_id);
create index if not exists reactions_type_idx on public.reactions(type);

-- 4. Count Management
create or replace function update_reaction_counts()
returns trigger
language plpgsql
security definer
as $$
declare
  column_name text;
begin
  -- Determine column based on type
  if (TG_OP = 'INSERT' and NEW.type = 'like') or (TG_OP = 'DELETE' and OLD.type = 'like') then
    column_name := 'likes_count';
  elsif (TG_OP = 'INSERT' and NEW.type = 'repost') or (TG_OP = 'DELETE' and OLD.type = 'repost') then
    column_name := 'reposts_count';
  elsif (TG_OP = 'INSERT' and NEW.type = 'bookmark') or (TG_OP = 'DELETE' and OLD.type = 'bookmark') then
    column_name := 'bookmarks_count';
  else
    return null;
  end if;

  if TG_OP = 'INSERT' then
    execute format('update public.posts set %I = %I + 1 where id = $1', column_name, column_name) using NEW.post_id;
  elsif TG_OP = 'DELETE' then
    execute format('update public.posts set %I = greatest(0, %I - 1) where id = $1', column_name, column_name) using OLD.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_reaction_change on public.reactions;
create trigger on_reaction_change
  after insert or delete on public.reactions
  for each row execute function update_reaction_counts();
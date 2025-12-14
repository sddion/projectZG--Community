-- Posts System 

-- 1. Posts Table
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content_text text check (char_length(content_text) <= 5000),
  
  -- Media Support (Array of URLs or relation)
  media_urls text[] default '{}', 
  
  -- Metadata
  likes_count integer default 0,
  comments_count integer default 0,
  reposts_count integer default 0,
  bookmarks_count integer default 0, 
  
  is_edited boolean default false,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 2. RLS Policies
alter table public.posts enable row level security;

create policy "Everyone can view posts"
  on public.posts for select
  using (true);

create policy "Users can create posts"
  on public.posts for insert
  with check (auth.uid() = author_id);

create policy "Users can update own posts"
  on public.posts for update
  using (auth.uid() = author_id);

create policy "Users can delete own posts"
  on public.posts for delete
  using (auth.uid() = author_id);

create index if not exists posts_created_at_idx on public.posts(created_at desc);

-- 3. Count Management
create or replace function update_profile_posts_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    update public.profiles set posts_count = posts_count + 1 where id = NEW.author_id;
  elsif TG_OP = 'DELETE' then
    update public.profiles set posts_count = greatest(0, posts_count - 1) where id = OLD.author_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_post_change on public.posts;
create trigger on_post_change
  after insert or delete on public.posts
  for each row execute function update_profile_posts_count();

-- Comments System 

-- 1. Comments Table
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 2000),
  parent_id uuid references public.comments(id) on delete cascade, -- For nested replies
  
  -- Metadata
  likes_count integer default 0,
  replies_count integer default 0,
  is_edited boolean default false,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 2. RLS Policies
alter table public.comments enable row level security;

create policy "Comments are viewable by everyone"
  on public.comments for select using (true);

create policy "Users can create comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "Users can update own comments"
  on public.comments for update
  using (auth.uid() = user_id);

create policy "Users can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);

-- 3. Indexes
create index if not exists comments_post_created_idx on public.comments(post_id, created_at asc);
create index if not exists comments_parent_idx on public.comments(parent_id);
create index if not exists comments_user_idx on public.comments(user_id);


-- 4. Comment Likes Table
create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  unique(comment_id, user_id)
);

alter table public.comment_likes enable row level security;

-- RLS policies for comment_likes
create policy "Anyone can view comment likes"
  on public.comment_likes for select
  using (true);

create policy "Authenticated users can like comments"
  on public.comment_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can unlike own comment likes"
  on public.comment_likes for delete
  using (auth.uid() = user_id);

-- Add likes_count column to comments table
alter table public.comments 
add column if not exists likes_count integer default 0;

-- Function to update comment like count
create or replace function update_comment_like_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    update public.comments set likes_count = likes_count + 1 where id = NEW.comment_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update public.comments set likes_count = greatest(0, likes_count - 1) where id = OLD.comment_id;
    return OLD;
  end if;
end;
$$;

-- Trigger to update comment like count
drop trigger if exists on_comment_like_change on public.comment_likes;
create trigger on_comment_like_change
  after insert or delete on public.comment_likes
  for each row
  execute function update_comment_like_count();

-- Indexes for performance
create index if not exists comment_likes_comment_id_idx on public.comment_likes(comment_id);
create index if not exists comment_likes_user_id_idx on public.comment_likes(user_id);
create index if not exists comments_likes_count_idx on public.comments(likes_count);-- Function to update post comment count (Handling replies)
create or replace function update_post_comment_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' then
    -- Only count top-level comments (where parent_id is NULL)
    if NEW.parent_id is null then
      update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    -- Only decrease count for top-level comments
    if OLD.parent_id is null then
      update public.posts set comments_count = greatest(0, comments_count - 1) where id = OLD.post_id;
    end if;
    return OLD;
  end if;
end;
$$;

drop trigger if exists on_comment_post_count on public.comments;
create trigger on_comment_post_count
  after insert or delete on public.comments
  for each row execute function update_post_comment_count();

-- Function to update parent comment replies_count
create or replace function update_comment_replies_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'INSERT' and NEW.parent_id is not null then
    update public.comments set replies_count = replies_count + 1 where id = NEW.parent_id;
    return NEW;
  elsif TG_OP = 'DELETE' and OLD.parent_id is not null then
    update public.comments set replies_count = greatest(0, replies_count - 1) where id = OLD.parent_id;
    return OLD;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists on_comment_replies_count on public.comments;
create trigger on_comment_replies_count
  after insert or delete on public.comments
  for each row execute function update_comment_replies_count();
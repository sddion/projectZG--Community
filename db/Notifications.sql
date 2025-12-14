-- Notifications System 

-- 1. Notifications Table
-- Optimized for high-volume reads and efficient filtering
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('follow', 'like', 'comment', 'repost', 'message', 'mention')),
  actor_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  read boolean default false,
  metadata jsonb default '{}'::jsonb, -- Flexible metadata for future extensibility (e.g. comment snippets)
  created_at timestamp with time zone default now()
);

alter table public.notifications enable row level security;

-- 2. RLS Policies
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "System can create notifications"
  on public.notifications for insert
  with check (true); 

create policy "Users can dismiss (update) own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- 3. Indexes
-- Compound index for fetching a user's unread/read notifications quickly
create index if not exists notifications_user_read_created_idx on public.notifications(user_id, read, created_at desc);
create index if not exists notifications_post_idx on public.notifications(post_id);


-- 4. Notification Preferences Table
-- Granular control over notification types
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  
  -- Push/In-App toggles
  "follow" boolean default true,
  "like" boolean default true,
  "comment" boolean default true,
  "repost" boolean default true,
  "mention" boolean default true,
  
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  
  unique(user_id)
);

alter table public.notification_preferences enable row level security;

-- RLS for Preferences
create policy "Users can view own preferences"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.notification_preferences for update
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

-- 5. Auto-Create Preferences Trigger
create or replace function public.handle_new_profile_notification_prefs()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_notification_prefs on public.profiles;
create trigger on_profile_created_notification_prefs
  after insert on public.profiles
  for each row
  execute function public.handle_new_profile_notification_prefs();

-- 6. Notification Triggers

-- Follow Notification
create or replace function create_follow_notification()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.notifications (user_id, type, actor_id, created_at)
    values (NEW.following_id, 'follow', NEW.follower_id, now());
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_follow_create_notification on public.follows;
create trigger on_follow_create_notification
  after insert on public.follows
  for each row execute function create_follow_notification();

-- Post Like Notification
create or replace function create_post_like_notification()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' and NEW.post_id is not null and NEW.type = 'like' then
    insert into public.notifications (user_id, type, actor_id, post_id, created_at)
    select p.author_id, 'like', NEW.user_id, NEW.post_id, now()
    from public.posts p
    where p.id = NEW.post_id and p.author_id != NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_post_like_create_notification on public.reactions;
create trigger on_post_like_create_notification
  after insert on public.reactions
  for each row execute function create_post_like_notification();

-- Comment Notification
create or replace function create_comment_notification()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.notifications (user_id, type, actor_id, post_id, created_at)
    select p.author_id, 'comment', NEW.user_id, NEW.post_id, now()
    from public.posts p
    where p.id = NEW.post_id and p.author_id != NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_comment_create_notification on public.comments;
create trigger on_comment_create_notification
  after insert on public.comments
  for each row execute function create_comment_notification();

-- Repost Notification
create or replace function create_repost_notification()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' and NEW.post_id is not null and NEW.type = 'repost' then
    insert into public.notifications (user_id, type, actor_id, post_id, created_at)
    select p.author_id, 'repost', NEW.user_id, NEW.post_id, now()
    from public.posts p
    where p.id = NEW.post_id and p.author_id != NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_repost_create_notification on public.reactions;
create trigger on_repost_create_notification
  after insert on public.reactions
  for each row execute function create_repost_notification();

-- Reply Notification (notify parent comment author when someone replies)

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check 
  CHECK (type in ('follow', 'like', 'comment', 'repost', 'message', 'mention', 'reply'));

create or replace function create_reply_notification()
returns trigger language plpgsql security definer as $$
begin
  -- Only trigger for replies (comments with parent_id)
  if TG_OP = 'INSERT' and NEW.parent_id is not null then
    insert into public.notifications (user_id, type, actor_id, post_id, metadata, created_at)
    select c.user_id, 'reply', NEW.user_id, NEW.post_id, 
           jsonb_build_object('comment_id', NEW.parent_id), now()
    from public.comments c
    where c.id = NEW.parent_id and c.user_id != NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_reply_create_notification on public.comments;
create trigger on_reply_create_notification
  after insert on public.comments
  for each row execute function create_reply_notification();



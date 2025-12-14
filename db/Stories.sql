-- Create stories table to track user stories
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_id uuid references public.media(id) on delete set null,
  media_url text not null,
  media_type text default 'image' check (media_type in ('image', 'video')),
  caption text check (char_length(caption) <= 500),
  
  -- Metadata
  views_count integer default 0,
  
  -- Expiration Logic
  expires_at timestamp with time zone default (now() + interval '24 hours'),
  created_at timestamp with time zone default now()
);

-- 2. RLS Policies
alter table public.stories enable row level security;

create policy "Active stories are viewable by everyone"
  on public.stories for select
  using (expires_at > now());

create policy "Users can create stories"
  on public.stories for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own stories"
  on public.stories for delete
  using (auth.uid() = user_id);

-- Indexes for better performance
create index if not exists stories_user_id_idx on public.stories(user_id);
create index if not exists stories_expires_at_idx on public.stories(expires_at);
create index if not exists stories_created_at_idx on public.stories(created_at desc);

-- Drop old trigger + function safely
drop trigger if exists stories_updated_at_trigger on public.stories;
drop function if exists public.update_stories_updated_at() cascade;

-- create function
create function public.update_stories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- create trigger
create trigger stories_updated_at_trigger
  before update on public.stories
  for each row
  execute function public.update_stories_updated_at();
-- Create function to increment story views
CREATE OR REPLACE FUNCTION increment_story_views(story_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  affected_rows INT;
BEGIN
  UPDATE public.stories 
  SET views_count = views_count + 1 
  WHERE id = story_id;
  
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_story_views(UUID) TO authenticated;

-- Create function to delete expired stories
CREATE OR REPLACE FUNCTION delete_expired_stories()
RETURNS VOID AS $$
BEGIN
  -- Delete expired stories
  DELETE FROM public.stories 
  WHERE expires_at < NOW();
  
  -- Also clean up orphaned media that's no longer referenced by any story
  DELETE FROM public.media 
  WHERE id IN (
    SELECT m.id FROM public.media m
    LEFT JOIN public.stories s ON m.id = s.media_id
    WHERE m.bucket_name = 'stories' AND s.id IS NULL
  );
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to postgres (for scheduled jobs)
GRANT EXECUTE ON FUNCTION delete_expired_stories() TO postgres;

-- Create a scheduled job to run this function daily
SELECT cron.schedule('delete-expired-stories', '0 0 * * *', $$SELECT delete_expired_stories();$$);

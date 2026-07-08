create extension if not exists "pgcrypto";

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists teams_name_lower_unique
  on public.teams (lower(name));

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  joined_at timestamptz not null default now()
);

create unique index if not exists team_members_team_name_lower_unique
  on public.team_members (team_id, lower(full_name));

create index if not exists team_members_team_id_idx
  on public.team_members (team_id);

create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
as $$
begin
  perform 1
  from public.teams
  where id = new.team_id
  for update;

  if (
    select count(*)
    from public.team_members
    where team_id = new.team_id
      and id <> new.id
  ) >= 10 then
    raise exception 'This team already has 10 people, so it is full. Please join a new team.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_team_member_limit_before_write on public.team_members;

create trigger enforce_team_member_limit_before_write
before insert or update of team_id on public.team_members
for each row
execute function public.enforce_team_member_limit();

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  program_name text not null check (length(trim(program_name)) > 0),
  office_site text not null check (length(trim(office_site)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.participant_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null check (length(trim(email)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.participant_contacts
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists participant_contacts_email_lower_unique
  on public.participant_contacts (lower(email));

create unique index if not exists participant_contacts_name_lower_unique
  on public.participant_contacts (lower(full_name));

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  participant_name text not null check (length(trim(participant_name)) > 0),
  miles numeric(8, 2) not null check (miles > 0),
  activity_type text not null check (length(trim(activity_type)) > 0),
  duration text,
  activity_date date not null,
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activities_team_id_idx
  on public.activities (team_id);

create index if not exists activities_participant_name_lower_idx
  on public.activities (lower(participant_name));

create table if not exists public.distance_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  team_name text not null check (length(trim(team_name)) > 0),
  member_id uuid references public.team_members(id) on delete set null,
  member_name text not null check (length(trim(member_name)) > 0),
  entry_mode text not null check (entry_mode in ('daily', 'weekly')),
  week_number integer not null check (week_number >= 1),
  daily_miles jsonb not null default '[]'::jsonb,
  weekly_miles numeric(8, 2) not null default 0 check (weekly_miles >= 0),
  total_miles numeric(8, 2) not null check (total_miles > 0),
  created_at timestamptz not null default now()
);

create index if not exists distance_entries_team_id_idx
  on public.distance_entries (team_id);

create index if not exists distance_entries_member_id_idx
  on public.distance_entries (member_id);

create index if not exists distance_entries_week_number_idx
  on public.distance_entries (week_number);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  author_name text not null check (length(trim(author_name)) > 0),
  parent_message_id uuid references public.messages(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  team_name text,
  message_text text not null check (length(trim(message_text)) > 0),
  image_data text,
  image_name text,
  created_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists author_name text,
  add column if not exists parent_message_id uuid references public.messages(id) on delete cascade,
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists team_name text,
  add column if not exists message_text text,
  add column if not exists image_data text,
  add column if not exists image_name text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

create index if not exists messages_team_id_idx
  on public.messages (team_id);

create index if not exists messages_parent_message_id_idx
  on public.messages (parent_message_id);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reaction_emoji text not null check (reaction_emoji in ('👍', '❤️', '👏', '🎉', '😊', '💪')),
  created_at timestamptz not null default now()
);

alter table public.message_reactions
  add column if not exists message_id uuid references public.messages(id) on delete cascade,
  add column if not exists reaction_emoji text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists message_reactions_message_id_idx
  on public.message_reactions (message_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.registrations enable row level security;
alter table public.participant_contacts enable row level security;
alter table public.activities enable row level security;
alter table public.distance_entries enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

grant select, insert, update, delete on public.teams to service_role;
grant select, insert, update, delete on public.team_members to service_role;
grant select, insert, update, delete on public.registrations to service_role;
grant select, insert, update, delete on public.participant_contacts to service_role;
grant select, insert, update, delete on public.activities to service_role;
grant select, insert, update, delete on public.distance_entries to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.message_reactions to service_role;

notify pgrst, 'reload schema';

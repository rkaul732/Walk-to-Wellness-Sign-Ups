create extension if not exists "pgcrypto";

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

alter table public.participant_contacts enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

grant select, insert, update, delete on public.participant_contacts to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.message_reactions to service_role;

notify pgrst, 'reload schema';

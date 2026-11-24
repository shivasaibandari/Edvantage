-- Edvantage: normalized, multi-workspace PostgreSQL schema.
-- All client-facing tables use RLS. Shared content is workspace-scoped;
-- practice rows are additionally scoped to auth.uid().
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.workspace_role as enum ('admin', 'editor', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict(id) do nothing;
  return new;
end;
$$;
create trigger auth_user_profile_after_insert after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'user',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);

create function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer
set search_path = '' set row_security = off as $$
  select exists(select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()));
$$;

create function public.has_workspace_role(target_workspace uuid, allowed public.workspace_role[])
returns boolean language sql stable security definer
set search_path = '' set row_security = off as $$
  select exists(select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid()) and m.role = any(allowed));
$$;

create function public.add_workspace_owner()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;
create trigger workspace_owner_after_insert after insert on public.workspaces
for each row execute function public.add_workspace_owner();

create table public.paper_tags (
  id smallint generated always as identity primary key,
  code text not null unique,
  label text not null,
  color text not null default 'sage',
  sort_order smallint not null unique
);
insert into public.paper_tags(code,label,color,sort_order) values
 ('GS1','GS1','rose',1),('GS2','GS2','blue',2),('GS3','GS3','amber',3),('GS4','GS4','violet',4),
 ('PSIR-P1A','PSIR-P1A','teal',5),('PSIR-P1B','PSIR-P1B','teal',6),
 ('PSIR-P2A','PSIR-P2A','teal',7),('PSIR-P2B','PSIR-P2B','teal',8),('Essay','Essay','gold',9);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 120),
  normalized_name text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  color text not null default 'sage',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(workspace_id, normalized_name),
  unique(workspace_id, id)
);
create index subjects_workspace_idx on public.subjects(workspace_id, normalized_name);

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_id uuid not null,
  name text not null check(length(trim(name)) between 1 and 180),
  normalized_name text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now(),
  foreign key(workspace_id, subject_id) references public.subjects(workspace_id,id) on delete cascade,
  unique(subject_id, normalized_name),
  unique(workspace_id,id),
  unique(workspace_id,subject_id,id)
);
create index themes_subject_idx on public.themes(workspace_id, subject_id, normalized_name);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'Untitled note' check(length(title) <= 300),
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  content_text text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(workspace_id,id),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_text,'')), 'B')
  ) stored
);
create index notes_workspace_updated_idx on public.notes(workspace_id, updated_at desc, id) where deleted_at is null;
create index notes_search_idx on public.notes using gin(search_vector);
create index notes_title_trgm_idx on public.notes using gin(title extensions.gin_trgm_ops);

create table public.note_papers (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  paper_id smallint not null references public.paper_tags(id),
  primary key(note_id,paper_id),
  foreign key(workspace_id,note_id) references public.notes(workspace_id,id) on delete cascade
);
create index note_papers_filter_idx on public.note_papers(workspace_id,paper_id,note_id);

create table public.note_subjects (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  subject_id uuid not null,
  primary key(note_id,subject_id),
  foreign key(workspace_id,note_id) references public.notes(workspace_id,id) on delete cascade,
  foreign key(workspace_id,subject_id) references public.subjects(workspace_id,id) on delete cascade
);
create index note_subjects_filter_idx on public.note_subjects(workspace_id,subject_id,note_id);

create table public.note_versions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  version integer not null,
  title text not null,
  content jsonb not null,
  content_text text not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  unique(note_id,version),
  foreign key(workspace_id,note_id) references public.notes(workspace_id,id) on delete cascade
);
create index note_versions_recent_idx on public.note_versions(note_id, changed_at desc);

create function public.capture_note_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.title is distinct from new.title or old.content is distinct from new.content or old.content_text is distinct from new.content_text then
    insert into public.note_versions(workspace_id,note_id,version,title,content,content_text,changed_by)
    values(old.workspace_id,old.id,old.version,old.title,old.content,old.content_text,coalesce(auth.uid(),old.updated_by));
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(),new.updated_by);
  end if;
  return new;
end;
$$;
create trigger notes_version_before_update before update on public.notes
for each row execute function public.capture_note_version();

create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  term text not null check(length(trim(term)) between 1 and 200),
  normalized_term text generated always as (lower(regexp_replace(trim(term), '\s+', ' ', 'g'))) stored,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,normalized_term),
  unique(workspace_id,id)
);
create index keywords_workspace_term_idx on public.keywords(workspace_id,normalized_term);
create index keywords_term_trgm_idx on public.keywords using gin(term extensions.gin_trgm_ops);
create table public.keyword_subjects (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_id uuid not null,
  subject_id uuid not null,
  primary key(keyword_id,subject_id),
  foreign key(workspace_id,keyword_id) references public.keywords(workspace_id,id) on delete cascade,
  foreign key(workspace_id,subject_id) references public.subjects(workspace_id,id) on delete cascade
);
create index keyword_subjects_filter_idx on public.keyword_subjects(workspace_id,subject_id,keyword_id);
create table public.keyword_papers (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_id uuid not null,
  paper_id smallint not null references public.paper_tags(id),
  primary key(keyword_id,paper_id),
  foreign key(workspace_id,keyword_id) references public.keywords(workspace_id,id) on delete cascade
);
create index keyword_papers_filter_idx on public.keyword_papers(workspace_id,paper_id,keyword_id);
create table public.keyword_notes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_id uuid not null,
  note_id uuid not null,
  primary key(keyword_id,note_id),
  foreign key(workspace_id,keyword_id) references public.keywords(workspace_id,id) on delete cascade,
  foreign key(workspace_id,note_id) references public.notes(workspace_id,id) on delete cascade
);

create table public.pyq_questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  exam_type text not null default 'Civil Services Examination',
  year smallint not null check(year between 1950 and 2200),
  paper_id smallint not null references public.paper_tags(id),
  subject_id uuid,
  theme_id uuid,
  question_number text not null default '',
  question_text text not null check(length(trim(question_text)) > 0),
  marks smallint check(marks is null or marks > 0),
  word_limit smallint check(word_limit is null or word_limit > 0),
  source_document text,
  source_page integer check(source_page is null or source_page > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english',coalesce(question_text,''))) stored,
  foreign key(workspace_id,subject_id) references public.subjects(workspace_id,id),
  foreign key(workspace_id,theme_id) references public.themes(workspace_id,id),
  foreign key(workspace_id,subject_id,theme_id) references public.themes(workspace_id,subject_id,id),
  check(theme_id is null or subject_id is not null),
  unique(workspace_id,id)
);
create unique index pyq_number_unique on public.pyq_questions(workspace_id,year,paper_id,question_number) where question_number<>'';
create unique index pyq_no_number_unique on public.pyq_questions
  (workspace_id,year,paper_id,md5(lower(regexp_replace(trim(question_text), '\s+', ' ', 'g'))))
  where question_number='';
create index pyq_filter_idx on public.pyq_questions(workspace_id,paper_id,year desc,subject_id,theme_id,id);
create index pyq_year_idx on public.pyq_questions(workspace_id,year desc,id);
create index pyq_search_idx on public.pyq_questions using gin(search_vector);
create index pyq_text_trgm_idx on public.pyq_questions using gin(question_text extensions.gin_trgm_ops);

create table public.pyq_answers (
  question_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  content_text text not null default '',
  version integer not null default 1 check(version > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english',coalesce(content_text,''))) stored,
  foreign key(workspace_id,question_id) references public.pyq_questions(workspace_id,id) on delete cascade
);
create index answers_workspace_updated_idx on public.pyq_answers(workspace_id,updated_at desc,question_id);
create index answers_search_idx on public.pyq_answers using gin(search_vector);
create table public.pyq_answer_versions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question_id uuid not null,
  version integer not null,
  content jsonb not null,
  content_text text not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  unique(question_id,version),
  foreign key(workspace_id,question_id) references public.pyq_questions(workspace_id,id) on delete cascade
);
create index answer_versions_recent_idx on public.pyq_answer_versions(question_id,changed_at desc);
create function public.capture_answer_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.content is distinct from new.content or old.content_text is distinct from new.content_text then
    insert into public.pyq_answer_versions(workspace_id,question_id,version,content,content_text,changed_by)
    values(old.workspace_id,old.question_id,old.version,old.content,old.content_text,coalesce(auth.uid(),old.updated_by));
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(),new.updated_by);
  end if;
  return new;
end;
$$;
create trigger answer_version_before_update before update on public.pyq_answers
for each row execute function public.capture_answer_version();

create table public.pyq_practice (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_id uuid not null references public.pyq_questions(id) on delete cascade,
  practiced_at timestamptz not null default now(),
  primary key(user_id,question_id),
  foreign key(workspace_id,question_id) references public.pyq_questions(workspace_id,id) on delete cascade
);
create index pyq_practice_user_workspace_idx on public.pyq_practice(user_id,workspace_id,question_id);

-- A scoped, atomic delete keeps reset semantics personal and transaction-safe.
create function public.reset_pyq_progress(target_workspace uuid, scope text, target_value text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare deleted_count bigint;
begin
  if scope not in ('paper','subject','theme') then raise exception 'Unsupported reset scope'; end if;
  delete from public.pyq_practice p
  using public.pyq_questions q
  where p.question_id=q.id and p.workspace_id=target_workspace and p.user_id=(select auth.uid())
    and q.workspace_id=target_workspace
    and ((scope='paper' and q.paper_id::text=target_value)
      or (scope='subject' and q.subject_id::text=target_value)
      or (scope='theme' and q.theme_id::text=target_value));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- RLS helpers intentionally query workspace_members from a SECURITY DEFINER
-- function to avoid recursive membership-table policies.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.paper_tags enable row level security;
alter table public.subjects enable row level security;
alter table public.themes enable row level security;
alter table public.notes enable row level security;
alter table public.note_papers enable row level security;
alter table public.note_subjects enable row level security;
alter table public.note_versions enable row level security;
alter table public.keywords enable row level security;
alter table public.keyword_subjects enable row level security;
alter table public.keyword_papers enable row level security;
alter table public.keyword_notes enable row level security;
alter table public.pyq_questions enable row level security;
alter table public.pyq_answers enable row level security;
alter table public.pyq_answer_versions enable row level security;
alter table public.pyq_practice enable row level security;

revoke all on all tables in schema public from anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant select on public.paper_tags to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid,public.workspace_role[]) to authenticated;
grant execute on function public.reset_pyq_progress(uuid,text,text) to authenticated;

create policy profiles_read_workspace on public.profiles for select to authenticated
using (id=(select auth.uid()) or exists(select 1 from public.workspace_members m where m.user_id=profiles.id and public.is_workspace_member(m.workspace_id)));
create policy profiles_update_self on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

create policy workspace_read_member on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy workspace_create_self on public.workspaces for insert to authenticated with check(created_by=(select auth.uid()));
create policy workspace_update_admin on public.workspaces for update to authenticated using(public.has_workspace_role(id,array['admin']::public.workspace_role[])) with check(public.has_workspace_role(id,array['admin']::public.workspace_role[]));
create policy workspace_delete_admin on public.workspaces for delete to authenticated using(public.has_workspace_role(id,array['admin']::public.workspace_role[]));

create policy membership_read_members on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy membership_insert_admin on public.workspace_members for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));
create policy membership_update_admin on public.workspace_members for update to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));
create policy membership_delete_admin on public.workspace_members for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));

create policy paper_tags_read_authenticated on public.paper_tags for select to authenticated using(true);

create policy subjects_read_member on public.subjects for select to authenticated using(public.is_workspace_member(workspace_id));
create policy subjects_write_editor on public.subjects for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy subjects_update_editor on public.subjects for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy subjects_delete_admin on public.subjects for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));

create policy themes_read_member on public.themes for select to authenticated using(public.is_workspace_member(workspace_id));
create policy themes_write_editor on public.themes for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy themes_update_editor on public.themes for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy themes_delete_admin on public.themes for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));

create policy notes_read_member on public.notes for select to authenticated using(public.is_workspace_member(workspace_id));
create policy notes_write_editor on public.notes for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]) and created_by=(select auth.uid()));
create policy notes_update_editor on public.notes for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy notes_delete_admin on public.notes for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));

create policy note_papers_read_member on public.note_papers for select to authenticated using(public.is_workspace_member(workspace_id));
create policy note_papers_write_editor on public.note_papers for all to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy note_subjects_read_member on public.note_subjects for select to authenticated using(public.is_workspace_member(workspace_id));
create policy note_subjects_write_editor on public.note_subjects for all to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy note_versions_read_member on public.note_versions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy note_versions_write_editor on public.note_versions for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]) and changed_by=(select auth.uid()));

create policy keywords_read_member on public.keywords for select to authenticated using(public.is_workspace_member(workspace_id));
create policy keywords_write_editor on public.keywords for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy keywords_update_editor on public.keywords for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy keywords_delete_admin on public.keywords for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));
create policy keyword_subjects_read_member on public.keyword_subjects for select to authenticated using(public.is_workspace_member(workspace_id));
create policy keyword_subjects_write_editor on public.keyword_subjects for all to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy keyword_papers_read_member on public.keyword_papers for select to authenticated using(public.is_workspace_member(workspace_id));
create policy keyword_papers_write_editor on public.keyword_papers for all to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy keyword_notes_read_member on public.keyword_notes for select to authenticated using(public.is_workspace_member(workspace_id));
create policy keyword_notes_write_editor on public.keyword_notes for all to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));

create policy pyq_read_member on public.pyq_questions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy pyq_write_editor on public.pyq_questions for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy pyq_update_editor on public.pyq_questions for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy pyq_delete_admin on public.pyq_questions for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));
create policy answers_read_member on public.pyq_answers for select to authenticated using(public.is_workspace_member(workspace_id));
create policy answers_write_editor on public.pyq_answers for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy answers_update_editor on public.pyq_answers for update to authenticated using(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[])) with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]));
create policy answers_delete_admin on public.pyq_answers for delete to authenticated using(public.has_workspace_role(workspace_id,array['admin']::public.workspace_role[]));
create policy answer_versions_read_member on public.pyq_answer_versions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy answer_versions_write_editor on public.pyq_answer_versions for insert to authenticated with check(public.has_workspace_role(workspace_id,array['admin','editor']::public.workspace_role[]) and changed_by=(select auth.uid()));

create policy practice_select_self on public.pyq_practice for select to authenticated using(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));
create policy practice_insert_self on public.pyq_practice for insert to authenticated with check(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));
create policy practice_delete_self on public.pyq_practice for delete to authenticated using(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));

-- Public API surface is authenticated-only; table grants do not override RLS.
comment on schema public is 'Edvantage normalized schema. Keep service_role keys server-side; browser clients use authenticated RLS policies.';

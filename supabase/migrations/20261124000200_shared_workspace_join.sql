-- Store user preferences in Supabase and route every authenticated Edvantage account into one shared workspace.
-- The existing project has already applied the base schema. Run this migration
-- once in the Supabase SQL Editor to enable shared multi-user onboarding.
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

create or replace function public.join_edvantage_workspace(workspace_label text default 'Edvantage Shared Workspace')
returns table(workspace_id uuid, member_role public.workspace_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  -- Serialize first-account setup so two signups cannot create separate libraries.
  perform pg_advisory_xact_lock(39143, 7712);

  select w.id into v_workspace_id
  from public.workspaces w
  order by w.created_at, w.id
  limit 1;

  if v_workspace_id is null then
    insert into public.workspaces(name, created_by)
    values (workspace_label, v_user_id)
    returning id into v_workspace_id;
    -- The existing owner trigger creates this first member as admin.
  else
    insert into public.workspace_members(workspace_id, user_id, role)
    values (v_workspace_id, v_user_id, 'editor')
    on conflict do nothing;
  end if;

  return query
  select m.workspace_id, m.role
  from public.workspace_members m
  where m.workspace_id = v_workspace_id and m.user_id = v_user_id;
end;
$$;

revoke all on function public.join_edvantage_workspace(text) from public, anon;
grant execute on function public.join_edvantage_workspace(text) to authenticated;

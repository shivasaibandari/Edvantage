-- Adds syllabus hierarchy and typed PYQ records for structured GS, Essay and case-study analysis.
alter table public.pyq_questions
  add column if not exists syllabus_area text,
  add column if not exists question_kind text not null default 'question'
    check (question_kind in ('question','case_study','essay')),
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists pyq_area_filter_idx
  on public.pyq_questions(workspace_id, paper_id, subject_id, syllabus_area, theme_id, year desc);
create index if not exists pyq_kind_filter_idx
  on public.pyq_questions(workspace_id, question_kind, year desc, id);

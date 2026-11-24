-- UPSC mains questions can carry fractional marks (for example, 12.5).
-- Keep imported source values intact instead of coercing them to integers.
alter table public.pyq_questions
  alter column marks type numeric using marks::numeric;

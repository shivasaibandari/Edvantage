# Edvantage backend and scaling

## Data ownership

Supabase is the single datastore for profiles and preferences, shared notes, paper and subject associations, keywords, questions and themes, answers, edit versions, and user-isolated practice marks. Only the authentication session and a clean-start marker remain in browser storage. The app performs no local study-data fallback.

The base schema and RLS policies are in `supabase/migrations/20261124000100_initial_schema.sql`. The configured project needs the follow-up shared onboarding function in `supabase/migrations/20261124000200_shared_workspace_join.sql`; this makes all authenticated users join the same workspace while preserving per-user practice rows.

## Data paths

- Shared content is scoped to a single collaborative workspace and protected by row-level security.
- Each account's practice rows are scoped to its authenticated user ID.
- Notes and answer changes create version rows through database triggers.
- Progress resets use the database transaction function `reset_pyq_progress`.
- The browser uses only the publishable key; the service-role key is never client-side.

## Scaling work

The schema is normalized and indexed, and the adapter fetches in PostgREST ranges. The current interface still loads collections into memory for client-side filtering. Before onboarding a large cohort, add keyset pagination for notes and questions, SQL aggregate endpoints for progress, atomic RPCs for multi-table tag updates, optimistic conflict checks, Storage policies for images, and RLS integration tests. Enable Supabase backups and point-in-time recovery before production study data is added.

# Edvantage

Edvantage is a collaborative UPSC study workspace with a shared knowledge library and private, per-account practice tracking.

## Run

Open `index.html` in a modern browser. Tailwind CSS is compiled locally; after editing UI styles or utility classes, run `npm run build:css`. Use `npm run watch:css` during UI work.

## Supabase data model

Supabase provides authentication and stores shared keywords, PYQs, answers, profiles, and each account’s practice state, display name, and theme preference. Notes are stored in the connected Notion Document Hub database. The browser keeps only the Supabase authentication session and a clean-start marker; study data is not persisted there.

The base schema in `supabase/migrations/20261124000100_initial_schema.sql` was already applied to the configured project. For all accounts to share the same library, apply `supabase/migrations/20261124000200_shared_workspace_join.sql` once in the Supabase SQL Editor. New authenticated accounts will join the same workspace automatically. The first account is its admin; later accounts join as editors.

The browser client uses only the publishable key from the gitignored `supabase-config.js`. Never put a service-role key in the app.

The question bank starts empty because the source question document was not included. Import verified JSON or CSV data from the PYQ page.

## Publish with Vercel

Import `shivasaibandari/Edvantage` into Vercel with the repository root as the project root. The build creates `dist/` and Vercel deploys the `/api/notion/notes` serverless function alongside it. Configure the environment variables in the Notion setup section below before deploying.

## Notion-backed shared notes (Vercel)

The Notes module lists Notion article titles and tags as horizontal cards. Opening a card loads the page blocks into Edvantage’s note editor; saving changes writes the supported blocks and tags back to the Document Hub. Paper tags map to `Subjects`, subject tags map to `Type`, and the article title maps to `Doc name`. Page breadcrumbs follow the optional `Parent note` relation.

Configure these Vercel environment variables:

- `NOTION_API_KEY` — a Notion internal integration token with read, insert, and update content capabilities.
- `NOTION_DATA_SOURCE_ID` — optional; defaults to the Document Hub data source (`416d1ba9-def4-8045-b320-000b2a0bb120`).
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` — the same public Supabase project values used by the app.

Share the Document Hub with that integration. Edvantage preserves supported page blocks and Notion text colors when loading and saving content. To keep nested notes, add a `Parent note` relation property on Document Hub that relates to Document Hub itself.

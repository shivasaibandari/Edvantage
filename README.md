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

## Notion page index and embeds (Vercel)

Edvantage fetches only page titles, paper tags, subject tags, timestamps, and page URLs from the shared **Document Hub** data source. It does not fetch Notion page blocks, copy page bodies into Supabase, or write/delete Notion pages. Selecting an item opens its Notion page in an iframe beneath Edvantage’s own header and module navigation. The page’s Notion sharing permissions control whether a user can view or edit it; the “Open in Notion” link is available if the browser or Notion does not allow the embedded sign-in flow.

Configure these Vercel environment variables:

- `NOTION_API_KEY` — a Notion internal integration token with read access to the Document Hub data source.
- `NOTION_DATA_SOURCE_ID` — optional; defaults to the Document Hub data source (`416d1ba9-def4-8045-b320-000b2a0bb120`).
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` — the same public Supabase project values used by the app.

Share the Document Hub with the Notion integration so it can list page properties. The existing database fields `Doc name`, `Subjects`, and `Type` map to the page title, paper tags, and subject tags. Individual users must have Notion access to a page for Notion to permit editing it; Edvantage only displays the page index and embeds the page URL.

# Edvantage

Edvantage is a collaborative UPSC study workspace with a shared knowledge library and private, per-account practice tracking.

## Run

Open `index.html` in a modern browser. Tailwind CSS is compiled locally; after editing UI styles or utility classes, run `npm run build:css`. Use `npm run watch:css` during UI work.

## Supabase data model

The configured Supabase project is the application’s only datastore for user and study content. Notes, paper and subject tags, keywords, PYQs, shared answers, edit history, profiles, and each account’s practice state, display name, and theme preference are stored in the database. The browser keeps only the Supabase authentication session and a clean-start marker; study data is not persisted there.

The base schema in `supabase/migrations/20261124000100_initial_schema.sql` was already applied to the configured project. For all accounts to share the same library, apply `supabase/migrations/20261124000200_shared_workspace_join.sql` once in the Supabase SQL Editor. New authenticated accounts will join the same workspace automatically. The first account is its admin; later accounts join as editors.

The browser client uses only the publishable key from the gitignored `supabase-config.js`. Never put a service-role key in the app.

The question bank starts empty because the source question document was not included. Import verified JSON or CSV data from the PYQ page.

## Publish with GitHub Pages

The workflow in `.github/workflows/pages.yml` builds the Tailwind stylesheet and deploys the static app when changes reach `main` (or when manually started). It creates the browser config from repository Actions secrets at build time; `supabase-config.js` stays out of Git.

Before the first deployment:

1. In the repository settings, add Actions secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the Supabase project URL and public publishable/anon key.
2. Under **Settings → Pages**, set the publishing source to **GitHub Actions**.
3. After deployment, add the published Pages URL to Supabase Auth’s allowed redirect URLs and set the site URL as needed for email links.

Never use a Supabase service-role key in these secrets or in the browser app.

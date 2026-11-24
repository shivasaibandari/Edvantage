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

The workflow in `.github/workflows/pages.yml` builds the Tailwind stylesheet and deploys the static app when changes reach `main` (or when manually started). `supabase-config.js` contains only the Supabase project URL and browser publishable key, which are public client configuration; never add a service-role key.

Before the first deployment, set the repository’s Pages source to **GitHub Actions** under **Settings → Pages**. After deployment, add the published Pages URL to Supabase Auth’s allowed redirect URLs and set the site URL as needed for email links.

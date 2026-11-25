const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, '..', 'dist');
fs.rmSync(output, {recursive:true, force:true});
fs.mkdirSync(output, {recursive:true});
const root = path.join(__dirname, '..');
for (const file of ['index.html','styles.css','app.js','supabase-client.js','supabase-data.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
const supabaseUrl = process.env.SUPABASE_URL || '';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
if (supabaseUrl && publishableKey) {
  const config = `window.EDVANTAGE_SUPABASE_CONFIG = ${JSON.stringify({url:supabaseUrl,publishableKey})};\n`;
  fs.writeFileSync(path.join(output, 'supabase-config.js'), config);
} else if (fs.existsSync(path.join(root, 'supabase-config.js'))) {
  fs.copyFileSync(path.join(root, 'supabase-config.js'), path.join(output, 'supabase-config.js'));
} else {
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the Vercel build.');
}

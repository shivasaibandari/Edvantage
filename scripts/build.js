const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, '..', 'dist');
fs.rmSync(output, {recursive:true, force:true});
fs.mkdirSync(output, {recursive:true});
for (const file of ['index.html','styles.css','app.js','supabase-client.js','supabase-data.js','supabase-config.js']) {
  fs.copyFileSync(path.join(__dirname, '..', file), path.join(output, file));
}

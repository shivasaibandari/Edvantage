const NOTION_VERSION = '2026-03-11';
const DEFAULT_DATA_SOURCE_ID = '416d1ba9-def4-8045-b320-000b2a0bb120';
const notionToken = () => process.env.NOTION_API_KEY || process.env.NOTION_API_TOKEN || process.env.NOTION_TOKEN;
const dataSourceId = () => process.env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
const supabaseUrl = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = () => process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function notion(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${notionToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Notion returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requireUser(req) {
  const bearer = req.headers.authorization || '';
  if (!bearer.startsWith('Bearer ')) return false;
  const response = await fetch(`${supabaseUrl().replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey(),
      Authorization: bearer
    }
  });
  return response.ok;
}

async function allPages() {
  const pages = [];
  const source = await notion(`/data_sources/${dataSourceId()}`);
  const papers = (source.properties?.Subjects?.multi_select?.options || []).map(x => ({ 'P1A': 'PSIR-P1A', 'P1B': 'PSIR-P1B', 'P2A': 'PSIR-P2A', 'P2B': 'PSIR-P2B' }[x.name] || x.name));
  const subjects = (source.properties?.Type?.multi_select?.options || []).map(x => x.name);
  let cursor;
  do {
    const result = await notion(`/data_sources/${dataSourceId()}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    for (let i = 0; i < (result.results || []).length; i += 5) {
      const batch = result.results.slice(i, i + 5).map(page => ({
        id: page.id,
        title: page.properties?.['Doc name']?.title?.map(x => x.plain_text).join('') || 'Untitled note',
        papers: (page.properties?.Subjects?.multi_select || []).map(x => ({ 'P1A': 'PSIR-P1A', 'P1B': 'PSIR-P1B', 'P2A': 'PSIR-P2A', 'P2B': 'PSIR-P2B' }[x.name] || x.name)),
        subjects: (page.properties?.Type?.multi_select || []).map(x => x.name),
        parentId: page.properties?.['Parent note']?.relation?.[0]?.id || null,
        createdAt: page.created_time,
        updatedAt: page.last_edited_time,
        url: page.url || page.public_url || `https://www.notion.so/${String(page.id || '').replace(/-/g, '')}`
      }));
      pages.push(...batch);
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return { notes: pages, papers, subjects, supportsNesting: source.properties?.['Parent note']?.type === 'relation' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (!notionToken() || !supabaseUrl() || !supabaseKey()) {
    return send(res, 503, { error: 'Notion sync is not configured on the server yet.' });
  }
  try {
    if (!await requireUser(req)) return send(res, 401, { error: 'Sign in to access shared notes.' });
    return send(res, 200, await allPages());
  } catch (error) {
    return send(res, error.status || 502, { error: error.message || 'Notion request failed.' });
  }
};

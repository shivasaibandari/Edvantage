const NOTION_VERSION = '2026-03-11';

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
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
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
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: bearer
    }
  });
  return response.ok;
}

async function listChildren(blockId, depth = 0) {
  const blocks = [];
  let cursor;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const page = await notion(`/blocks/${blockId}/children?${query}`);
    for (const block of page.results || []) {
      const child = { ...block, children: [] };
      if (block.has_children && depth >= 10) {
        const error = new Error('This Notion page is nested too deeply for a safe Edvantage edit.');
        error.status = 409;
        throw error;
      }
      if (block.has_children) child.children = await listChildren(block.id, depth + 1);
      blocks.push(child);
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return blocks;
}

async function allPages() {
  const pages = [];
  const source = await notion(`/data_sources/${process.env.NOTION_DATA_SOURCE_ID}`);
  const papers = (source.properties?.Subjects?.multi_select?.options || []).map(x => ({ 'P1A': 'PSIR-P1A', 'P1B': 'PSIR-P1B', 'P2A': 'PSIR-P2A', 'P2B': 'PSIR-P2B' }[x.name] || x.name));
  const subjects = (source.properties?.Type?.multi_select?.options || []).map(x => x.name);
  let cursor;
  do {
    const result = await notion(`/data_sources/${process.env.NOTION_DATA_SOURCE_ID}/query`, {
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
        url: page.url
      }));
      pages.push(...batch);
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return { notes: pages, papers, subjects, supportsNesting: source.properties?.['Parent note']?.type === 'relation' };
}

async function noteContent(id) {
  const page = await notion(`/pages/${id}`);
  const parent = page.parent || {};
  if (parent.data_source_id !== process.env.NOTION_DATA_SOURCE_ID) {
    const error = new Error('This page is outside the connected Document Hub.');
    error.status = 404;
    throw error;
  }
  return {
    id: page.id,
    contentBlocks: await listChildren(page.id),
    updatedAt: page.last_edited_time,
    url: page.url
  };
}

function validBlocks(value) {
  return Array.isArray(value) && value.length <= 1000 && value.every(block =>
    block && typeof block === 'object' && ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code', 'toggle', 'callout'].includes(block.type)
  );
}

function assertEditableBlocks(current) {
  const supported = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code', 'toggle', 'callout']);
  const hasUnsupported = blocks => blocks.some(block => !supported.has(block.type) || hasUnsupported(block.children || []));
  if (hasUnsupported(current)) {
    const error = new Error('This Notion page contains blocks Edvantage cannot safely preserve. Keep editing it in Notion or remove the unsupported blocks there first.');
    error.status = 409;
    throw error;
  }
}

async function removeChildren(pageId, current) {
  for (const block of current) {
    await notion(`/blocks/${block.id}`, { method: 'DELETE' });
  }
}

async function savePage(body) {
  if (typeof body.title !== 'string' || body.title.length > 200 || !validBlocks(body.blocks)) {
    const error = new Error('The note title or editor blocks are invalid.');
    error.status = 400;
    throw error;
  }
  const papers = Array.isArray(body.papers) ? body.papers : [];
  const subjects = Array.isArray(body.subjects) ? body.subjects : [];
  const properties = {
    'Doc name': { title: [{ text: { content: body.title.trim() || 'Untitled note' } }] },
    Subjects: { multi_select: papers.map(name => ({ name: ({ 'PSIR-P1A': 'P1A', 'PSIR-P1B': 'P1B', 'PSIR-P2A': 'P2A', 'PSIR-P2B': 'P2B' }[name] || String(name)).slice(0, 100) })) },
    Type: { multi_select: subjects.map(name => ({ name: String(name).slice(0, 100) })) }
  };
  if (body.parentId) {
    const source = await notion(`/data_sources/${process.env.NOTION_DATA_SOURCE_ID}`);
    const parentRelation = source.properties?.['Parent note']?.relation;
    if (source.properties?.['Parent note']?.type !== 'relation' || (parentRelation?.data_source_id && parentRelation.data_source_id !== process.env.NOTION_DATA_SOURCE_ID)) {
      const error = new Error('To save nested pages, add a “Parent note” relation property to Document Hub and relate it to Document Hub.');
      error.status = 409;
      throw error;
    }
    properties['Parent note'] = { relation: [{ id: body.parentId }] };
  }
  let page;
  let existingBlocks;
  if (body.id && /^[0-9a-f-]{36}$/i.test(body.id)) {
    const current = await notion(`/pages/${body.id}`);
    if (current.parent?.data_source_id !== process.env.NOTION_DATA_SOURCE_ID) {
      const error = new Error('This page is outside the connected Document Hub.');
      error.status = 404;
      throw error;
    }
    existingBlocks = await listChildren(current.id);
    assertEditableBlocks(existingBlocks);
    page = await notion(`/pages/${body.id}`, { method: 'PATCH', body: JSON.stringify({ properties }) });
    await removeChildren(page.id, existingBlocks);
  } else {
    page = await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: process.env.NOTION_DATA_SOURCE_ID }, properties })
    });
  }
  if (body.blocks.length) {
    for (let index = 0; index < body.blocks.length; index += 100) {
      await notion(`/blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: body.blocks.slice(index, index + 100) }) });
    }
  }
  return { id: page.id, url: page.url };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATA_SOURCE_ID || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    return send(res, 503, { error: 'Notion sync is not configured on the server yet.' });
  }
  try {
    if (!await requireUser(req)) return send(res, 401, { error: 'Sign in to access shared notes.' });
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'A valid note id is required.' });
        return send(res, 200, await noteContent(id));
      }
      return send(res, 200, await allPages());
    }
    if (req.method === 'POST') return send(res, 200, await savePage(req.body || {}));
    const id = String(req.query?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'A valid note id is required.' });
    const page = await notion(`/pages/${id}`);
    if (page.parent?.data_source_id !== process.env.NOTION_DATA_SOURCE_ID) return send(res, 404, { error: 'This page is outside the connected Document Hub.' });
    await notion(`/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, error.status || 502, { error: error.message || 'Notion request failed.' });
  }
};

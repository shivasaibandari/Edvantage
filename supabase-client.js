/* Small dependency-free Supabase Auth/PostgREST client for the static preview. */
(() => {
  const cfg = window.EDVANTAGE_SUPABASE_CONFIG || {};
  const SESSION_KEY = 'edvantage-auth-session-v1';
  const base = String(cfg.url || '').replace(/\/$/, '');
  const publicKey = cfg.publishableKey || '';
  const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const saveSession = value => value ? localStorage.setItem(SESSION_KEY, JSON.stringify(value)) : localStorage.removeItem(SESSION_KEY);
  async function request(url, options = {}, token = '') {
    const headers = new Headers(options.headers || {});
    headers.set('apikey', publicKey);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.set('Authorization', `Bearer ${publicKey}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {...options, headers});
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.hint || `Workspace request failed (${response.status})`);
    return data;
  }
  function ready() { return Boolean(base && publicKey); }
  function endpoint(path) { if (!ready()) throw new Error('App configuration is missing.'); return `${base}${path}`; }
  async function probe() {
    if (!ready()) throw new Error('App configuration is missing.');
    await request(endpoint('/auth/v1/settings'));
    return {url: base};
  }
  async function signUp(email, password, displayName) {
    const result = await request(endpoint('/auth/v1/signup'), {method:'POST', body:JSON.stringify({email,password,data:{full_name:displayName}})});
    if (result?.access_token) saveSession(result);
    return result;
  }
  async function signIn(email, password) {
    const result = await request(endpoint('/auth/v1/token?grant_type=password'), {method:'POST', body:JSON.stringify({email,password})});
    saveSession(result);
    return result;
  }
  async function refresh() {
    const session = readSession();
    if (!session?.refresh_token) return null;
    const result = await request(endpoint('/auth/v1/token?grant_type=refresh_token'), {method:'POST', body:JSON.stringify({refresh_token:session.refresh_token})});
    saveSession(result);
    return result;
  }
  async function session() {
    const value = readSession();
    if (!value?.access_token) return null;
    if (value.expires_at && value.expires_at * 1000 < Date.now() + 30000) return await refresh();
    return value;
  }
  async function api(path, options = {}) {
    let s = await session();
    if (!s?.access_token) throw new Error('Sign in to Edvantage first.');
    try { return await request(endpoint(`/rest/v1/${path}`), options, s.access_token); }
    catch (error) {
      if (/401|JWT|expired/i.test(error.message)) {
        s = await refresh();
        if (s?.access_token) return request(endpoint(`/rest/v1/${path}`), options, s.access_token);
      }
      throw error;
    }
  }
  async function rpc(name, args) {
    const s = await session();
    if (!s?.access_token) throw new Error('Sign in to Edvantage first.');
    return request(endpoint(`/rest/v1/rpc/${encodeURIComponent(name)}`), {method:'POST',body:JSON.stringify(args)}, s.access_token);
  }
  async function signOut() {
    const s = await session();
    try { if (s?.access_token) await request(endpoint('/auth/v1/logout'), {method:'POST'}, s.access_token); }
    finally { saveSession(null); }
  }
  window.EdvantageAuth = {ready,probe,signUp,signIn,signOut,session,api,rpc,config:{url:base,configured:ready()}};
})();

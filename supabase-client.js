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
  function appRedirectUrl() {
    const path = window.location.pathname;
    const root = path.endsWith('/') ? path : path.endsWith('.html') ? path.slice(0, path.lastIndexOf('/') + 1) : `${path}/`;
    return `${window.location.origin}${root}?auth=confirmed`;
  }
  async function getUser(accessToken) { return request(endpoint('/auth/v1/user'), {}, accessToken); }
  let redirectResult = null;
  async function consumeAuthRedirect() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const params = url.searchParams;
    const error = params.get('error_description') || params.get('error') || hash.get('error_description') || hash.get('error');
    const type = hash.get('type') || params.get('type') || (params.get('auth') === 'confirmed' ? 'signup' : '');
    const accessToken = hash.get('access_token') || params.get('access_token');
    const refreshToken = hash.get('refresh_token') || params.get('refresh_token');
    const code = params.get('code');
    if (!error && !accessToken && !code && params.get('auth') !== 'confirmed') return null;
    if (error) redirectResult = {status:'error', type, message:error};
    else if (accessToken && refreshToken) {
      try {
        const user = await getUser(accessToken);
        const expiresIn = Number(hash.get('expires_in') || params.get('expires_in') || 3600);
        saveSession({access_token:accessToken,refresh_token:refreshToken,token_type:hash.get('token_type')||'bearer',expires_in:expiresIn,expires_at:Math.floor(Date.now()/1000)+expiresIn,user});
        redirectResult = {status:'confirmed',type:type||'signup',email:user.email||''};
      } catch (e) { redirectResult = {status:'error',type,message:`We couldn’t complete the confirmation: ${e.message}`}; }
    } else if (code) {
      redirectResult = {status:'error',type,message:'This confirmation link uses a code flow that this app cannot exchange. Request a fresh confirmation email and use the Edvantage confirmation link.'};
    } else redirectResult = {status:'confirmed',type:type||'signup',email:''};
    for (const key of ['auth','error','error_description','error_code','type','access_token','refresh_token','expires_in','expires_at','token_type','code']) params.delete(key);
    url.hash = '';
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
    return redirectResult;
  }
  async function probe() {
    if (!ready()) throw new Error('App configuration is missing.');
    await request(endpoint('/auth/v1/settings'));
    return {url: base};
  }
  async function signUp(email, password, displayName) {
    const result = await request(`${endpoint('/auth/v1/signup')}?redirect_to=${encodeURIComponent(appRedirectUrl())}`, {method:'POST', body:JSON.stringify({email,password,data:{full_name:displayName}})});
    if (result?.access_token) saveSession(result);
    return result;
  }
  async function resendSignup(email) {
    return request(`${endpoint('/auth/v1/resend')}?redirect_to=${encodeURIComponent(appRedirectUrl())}`, {method:'POST',body:JSON.stringify({type:'signup',email})});
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
    if (window.location.hash.includes('access_token=') || new URLSearchParams(window.location.search).has('code') || new URLSearchParams(window.location.search).has('auth')) await consumeAuthRedirect();
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
  window.EdvantageAuth = {ready,probe,signUp,signIn,resendSignup,signOut,session,consumeAuthRedirect,get redirectResult(){return redirectResult},api,rpc,config:{url:base,configured:ready()}};
})();

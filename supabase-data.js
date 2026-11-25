/* Workspace-scoped repository. All access goes through authenticated PostgREST + RLS. */
(() => {
  const api = window.EdvantageAuth;
  let workspaceId = null;
  let userId = null;
  let papersByCode = new Map();
  let subjectsByName = new Map();
  let themesByName = new Map();
  let notionSubjectOptions = [];
  let notionSupportsNesting = false;
  let notionSyncIssue = '';
  const q = value => encodeURIComponent(String(value));
  const stamp = value => value ? new Date(value).getTime() : Date.now();
  const iso = value => value ? new Date(value).toISOString() : new Date().toISOString();
  const plain = html => { const d=document.createElement('div'); d.innerHTML=html||''; return d.textContent||''; };
  const norm = value => String(value||'').trim().replace(/\s+/g,' ').toLowerCase();

  async function getAll(table, params) {
    const out=[]; let start=0, step=1000;
    while (true) {
      const headers={'Range-Unit':'items','Range':`${start}-${start+step-1}`};
      const rows=await api.api(`${table}?${params}`,{headers});
      if (Array.isArray(rows)) out.push(...rows);
      if (!Array.isArray(rows)||rows.length<step) break;
      start+=step;
    }
    return out;
  }
  async function post(table, rows, conflict='') {
    if (!rows?.length) return [];
    const path=`${table}?${conflict?`on_conflict=${encodeURIComponent(conflict)}`:''}`;
    return api.api(path,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(rows)});
  }
  async function remove(table, filters) {
    return api.api(`${table}?${filters}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
  }
  async function ensureWorkspace(uid) {
    const joined=await api.rpc('join_edvantage_workspace',{workspace_label:'Edvantage Shared Workspace'});
    if (!joined?.[0]?.workspace_id) throw new Error('Shared workspace setup is incomplete. Apply the Edvantage SQL migration, then sign in again.');
    return {id:joined[0].workspace_id,role:joined[0].member_role};
  }
  async function connectUser(authUser) {
    userId=authUser.id;
    const membership=await ensureWorkspace(userId);
    workspaceId=membership.id;
    const data=await loadWorkspace();
    return {workspaceId,role:membership.role,data};
  }
  async function loadWorkspace() {
    if (!workspaceId||!userId) throw new Error('Sign in to load the workspace.');
    const w=`workspace_id=eq.${q(workspaceId)}`;
    const [papers,subjects,themes,keywords,keySubjects,keyPapers,questions,answers,answerVersions,practice,profiles]=await Promise.all([
      getAll('paper_tags','select=*&order=sort_order.asc'),
      getAll('subjects',`select=*&${w}&order=normalized_name.asc`),
      getAll('themes',`select=*&${w}&order=normalized_name.asc`),
      getAll('keywords',`select=*&${w}&order=term.asc`),
      getAll('keyword_subjects',`select=*&${w}`),
      getAll('keyword_papers',`select=*&${w}`),
      getAll('pyq_questions',`select=*&${w}&order=year.desc,id.asc`),
      getAll('pyq_answers',`select=*&${w}`),
      getAll('pyq_answer_versions',`select=*&${w}&order=changed_at.desc`),
      getAll('pyq_practice',`select=*&${w}&user_id=eq.${q(userId)}`),
      getAll('profiles','select=id,display_name,preferences')
    ]);
    papersByCode=new Map(papers.map(p=>[p.code,p.id]));
    subjectsByName=new Map(subjects.map(s=>[s.name,s.id]));
    themesByName=new Map(themes.map(t=>[`${t.subject_id}::${norm(t.name)}`,t.id]));
    const profilesById=new Map(profiles.map(p=>[p.id,p.display_name]));
    const paperCodes=new Map(papers.map(p=>[p.id,p.code]));
    const subjectNames=new Map(subjects.map(s=>[s.id,s.name]));
    const themeNames=new Map(themes.map(t=>[t.id,t.name]));
    const byNote=(rows,key)=>{const m=new Map();for(const r of rows){const a=m.get(r[key])||[];a.push(r);m.set(r[key],a)}return m};
    const kvS=byNote(keySubjects,'keyword_id'),kvP=byNote(keyPapers,'keyword_id');
    const av=byNote(answerVersions,'question_id');
    let noteRows=[];
    try { noteRows=await loadNotionNotes(); }
    catch(error) { notionSyncIssue=error.message||'Notion could not be reached.'; }
    const keywordRows=keywords.map(k=>({id:k.id,text:k.term,subjects:(kvS.get(k.id)||[]).map(x=>subjectNames.get(x.subject_id)).filter(Boolean),papers:(kvP.get(k.id)||[]).map(x=>paperCodes.get(x.paper_id)).filter(Boolean),createdBy:k.created_by,createdAt:stamp(k.created_at)}));
    const questionRows=questions.map(x=>({id:x.id,year:x.year,paper:paperCodes.get(x.paper_id)||'',number:x.question_number,text:x.question_text,subject:subjectNames.get(x.subject_id)||'',theme:themeNames.get(x.theme_id)||'',area:x.syllabus_area||'',sourcePage:x.source_page||null,sourceDocument:x.source_document||'',kind:x.question_kind||'question',metadata:x.source_metadata||{},marks:x.marks,wordLimit:x.word_limit,createdBy:x.created_by}));
    const answersByQuestion={};
    for(const a of answers) answersByQuestion[a.question_id]={content:a.content?.html||'',createdBy:a.created_by,updatedBy:a.updated_by,createdAt:stamp(a.created_at),updatedAt:stamp(a.updated_at),version:a.version,history:(av.get(a.question_id)||[]).map(v=>({content:v.content?.html||'',updatedBy:v.changed_by,updatedAt:stamp(v.changed_at)}))};
    const progressByUser={}; for(const p of practice) progressByUser[`${userId}:${p.question_id}`]=p.practiced_at||true;
    return {notes:noteRows,subjects:[...new Set([...subjects.map(s=>s.name),...notionSubjectOptions])],keywords:keywordRows,questions:questionRows,answers:answersByQuestion,practice:progressByUser,users:profiles.map(p=>({id:p.id,name:p.display_name||'Edvantage user',email:'',role:p.id===userId?'Editor':'User'})),currentUser:userId,papers,theme:profiles.find(p=>p.id===userId)?.preferences?.theme||'light'};
  }
  async function saveSubject(name) {
    const rows=await post('subjects',[{workspace_id:workspaceId,name,created_by:userId}],'workspace_id,normalized_name');
    if(rows?.[0]) subjectsByName.set(rows[0].name,rows[0].id);
    return rows?.[0];
  }
  async function deleteSubject(name) {
    const id=subjectsByName.get(name); if(!id) return;
    await remove('subjects',`workspace_id=eq.${q(workspaceId)}&id=eq.${q(id)}`);
    subjectsByName.delete(name);
  }
  async function subjectId(name) {
    if(subjectsByName.has(name)) return subjectsByName.get(name);
    const r=await saveSubject(name); if(!r?.id) throw new Error(`Could not create subject: ${name}`); return r.id;
  }
  async function themeId(name, subject) {
    if(!subject) throw new Error(`A subject is required to classify theme: ${name}`);
    const key=`${subject}::${norm(name)}`;
    if(themesByName.has(key)) return themesByName.get(key);
    const rows=await post('themes',[{workspace_id:workspaceId,subject_id:subject,name}],'subject_id,normalized_name');
    if(rows?.[0]?.id){themesByName.set(key,rows[0].id);return rows[0].id;}
    throw new Error(`Could not create theme: ${name}`);
  }
  function richTextFromNode(node, style={}) {
    if(node.nodeType===Node.TEXT_NODE) {
      const content=node.nodeValue||''; if(!content)return [];
      const {link,...annotations}=style, chunks=[];
      for(let i=0;i<content.length;i+=2000)chunks.push({type:'text',text:{content:content.slice(i,i+2000),...(link?{link}:{})},annotations});
      return chunks;
    }
    if(node.nodeType!==Node.ELEMENT_NODE) return [];
    const tag=node.tagName.toLowerCase(), next={...style};
    if(tag==='strong'||tag==='b')next.bold=true;
    if(tag==='em'||tag==='i')next.italic=true;
    if(tag==='u')next.underline=true;
    if(tag==='s'||tag==='del')next.strikethrough=true;
    if(tag==='code')next.code=true;
    if(tag==='a'&&node.href)next.link={url:node.href};
    const colorMap={'#81776e':'gray','#79543a':'brown','#c7682c':'orange','#a66d12':'yellow','#43805b':'green','#416da0':'blue','#7959a4':'purple','#b94d83':'pink','#ae493d':'red','#fde68a':'yellow_background','#fed7aa':'orange_background','#fbcfe8':'pink_background','#ddd6fe':'purple_background','#bfdbfe':'blue_background'};
    const normalizedColor=value=>{const rgb=String(value||'').match(/\d+/g);return rgb?.length>=3?`#${rgb.slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('')}`:String(value||'').toLowerCase()};
    const foreground=colorMap[normalizedColor(node.style?.color)];
    const background=colorMap[normalizedColor(node.style?.backgroundColor)];
    if(foreground)next.color=foreground;
    if(background)next.color=background;
    return [...node.childNodes].flatMap(child=>richTextFromNode(child,next));
  }
  function htmlToNotionBlocks(html) {
    const root=document.createElement('div'); root.innerHTML=html||'';
    const output=[];
    const rt=nodes=>nodes.flatMap(node=>richTextFromNode(node));
    const textBlock=(type,nodes,extra={})=>({object:'block',type,[type]:{rich_text:rt(nodes),...extra}});
    const walkList=(list,type)=>[...list.children].filter(x=>x.tagName==='LI').map(li=>{
      const nested=[...li.children].filter(x=>['UL','OL'].includes(x.tagName));
      const inline=[...li.childNodes].filter(x=>!(x.nodeType===Node.ELEMENT_NODE&&['UL','OL'].includes(x.tagName)));
      const block=textBlock(type==='UL'?'bulleted_list_item':'numbered_list_item',inline);
      if(nested.length)block[type==='UL'?'bulleted_list_item':'numbered_list_item'].children=nested.flatMap(x=>walkList(x,x.tagName));
      return block;
    });
    const visit=node=>{
      if(node.nodeType===Node.TEXT_NODE){if(node.nodeValue.trim())output.push(textBlock('paragraph',[node]));return}
      if(node.nodeType!==Node.ELEMENT_NODE)return;
      const tag=node.tagName.toLowerCase();
      if(tag==='ul'||tag==='ol'){output.push(...walkList(node,tag.toUpperCase()));return}
      if(/^h[1-3]$/.test(tag)){output.push(textBlock(`heading_${tag.slice(1)}`,[...node.childNodes]));return}
      if(tag==='aside'&&(node.classList.contains('notion-callout')||node.classList.contains('note-callout'))){output.push(textBlock('callout',[...node.childNodes],{icon:{type:'emoji',emoji:'💡'}}));return}
      if(tag==='blockquote'){output.push(textBlock('quote',[...node.childNodes]));return}
      if(tag==='pre'){output.push(textBlock('code',[...node.childNodes],{language:'plain text'}));return}
      if(tag==='details'){const summary=node.querySelector('summary'),children=[...node.children].filter(x=>x!==summary).flatMap(x=>htmlToNotionBlocks(x.outerHTML));output.push(textBlock('toggle',summary?[...summary.childNodes]:[],children.length?{children}:{}));return}
      if(['p','div','section','article'].includes(tag)){if([...node.children].some(x=>['P','DIV','UL','OL','H1','H2','H3','BLOCKQUOTE'].includes(x.tagName))){[...node.childNodes].forEach(visit);return}output.push(textBlock('paragraph',[...node.childNodes]));return}
      output.push(textBlock('paragraph',[node]));
    };
    [...root.childNodes].forEach(visit);
    return output.slice(0,1000);
  }
  function notionRichHtml(items=[]) {
    return items.map(item=>{
      let value=escHtml(item.plain_text||item.text?.content||'');
      const a=item.annotations||{};
      if(a.code)value=`<code>${value}</code>`;
      if(a.bold)value=`<strong>${value}</strong>`;
      if(a.italic)value=`<em>${value}</em>`;
      if(a.underline)value=`<u>${value}</u>`;
      if(a.strikethrough)value=`<s>${value}</s>`;
      if(a.color&&a.color!=='default'){
        const colors={gray:'#81776e',brown:'#79543a',orange:'#c7682c',yellow:'#a66d12',green:'#43805b',blue:'#416da0',purple:'#7959a4',pink:'#b94d83',red:'#ae493d'};
        const background=a.color.endsWith('_background'),color=a.color.replace('_background','');
        if(colors[color])value=`<span style="${background?`background-color:${colors[color]}`:`color:${colors[color]}`}">${value}</span>`;
      }
      if(item.href)value=`<a href="${escHtml(item.href)}">${value}</a>`;
      return value;
    }).join('');
  }
  function escHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function blocksToHtml(blocks=[]) {
    return blocks.map(block=>{
      const value=block[block.type]||{},content=notionRichHtml(value.rich_text||[]),children=blocksToHtml(block.children||[]);
      if(block.type==='heading_1'||block.type==='heading_2'||block.type==='heading_3')return `<h${block.type.slice(-1)}>${content}</h${block.type.slice(-1)}>${children}`;
      if(block.type==='bulleted_list_item')return `<ul><li>${content}${children}</li></ul>`;
      if(block.type==='numbered_list_item')return `<ol><li>${content}${children}</li></ol>`;
      if(block.type==='quote')return `<blockquote>${content}</blockquote>${children}`;
      if(block.type==='code')return `<pre><code>${content}</code></pre>`;
      if(block.type==='toggle')return `<details><summary>${content}</summary>${children}</details>`;
      if(block.type==='callout')return `<aside class="notion-callout">${content}${children}</aside>`;
      if(block.type==='to_do')return `<p><input type="checkbox" ${value.checked?'checked':''} disabled> ${content}</p>${children}`;
      if(block.type==='child_page')return `<p>${escHtml(value.title||'Nested page')}</p>`;
      return `<p>${content}</p>${children}`;
    }).join('');
  }
  async function notionRequest(method, body, id) {
    const session=await api.session();
    if(!session?.access_token)throw new Error('Sign in to access shared notes.');
    const url='/api/notion/notes'+(id?`?id=${encodeURIComponent(id)}`:'');
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`Notion request failed (${response.status})`);
    return data;
  }
  async function loadNotionNotes(){
    try {
      const result=await notionRequest('GET');
      notionSyncIssue='';
      notionSubjectOptions=result.subjects||[];
      notionSupportsNesting=Boolean(result.supportsNesting);
      return (result.notes||[]).map(n=>({id:n.id,title:n.title,content:'',contentLoaded:false,parentId:n.parentId||null,papers:n.papers||[],subjects:n.subjects||[],createdBy:'notion',updatedBy:'notion',createdAt:stamp(n.createdAt),updatedAt:stamp(n.updatedAt),history:[],notionUrl:n.url}));
    } catch(error) {
      notionSyncIssue=error.message||'Notion could not be reached.';
      throw error;
    }
  }
  async function loadNotionNoteContent(id){const result=await notionRequest('GET',null,id);return {content:blocksToHtml(result.contentBlocks),updatedAt:stamp(result.updatedAt),notionUrl:result.url}}
  function notionSubjects(){return notionSubjectOptions}
  function notionCanNest(){return notionSupportsNesting}
  function notionError(){return notionSyncIssue}
  async function saveNote(note) {
    const result=await notionRequest('POST',{id:note.id,title:note.title,papers:note.papers||[],subjects:note.subjects||[],parentId:note.parentId||null,blocks:htmlToNotionBlocks(note.content)});
    note.id=result.id;
    note.notionUrl=result.url;
  }
  async function deleteNote(id) {
    return notionRequest('DELETE',null,id);
  }
  async function saveKeyword(keyword) {
    const isNew=!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(keyword.id); if(isNew) keyword.id=crypto.randomUUID();
    await post('keywords',[{id:keyword.id,workspace_id:workspaceId,term:keyword.text,created_by:keyword.createdBy||userId,updated_by:userId}],'id');
    await remove('keyword_subjects',`workspace_id=eq.${q(workspaceId)}&keyword_id=eq.${q(keyword.id)}`);
    await remove('keyword_papers',`workspace_id=eq.${q(workspaceId)}&keyword_id=eq.${q(keyword.id)}`);
    const ss=[];for(const name of keyword.subjects||[])ss.push({workspace_id:workspaceId,keyword_id:keyword.id,subject_id:await subjectId(name)});
    const pp=(keyword.papers||[]).filter(x=>papersByCode.has(x)).map(x=>({workspace_id:workspaceId,keyword_id:keyword.id,paper_id:papersByCode.get(x)}));
    await post('keyword_subjects',ss,'keyword_id,subject_id');await post('keyword_papers',pp,'keyword_id,paper_id');
  }
  async function saveQuestion(question) {
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(question.id)) question.id=crypto.randomUUID();
    const sid=question.subject?await subjectId(question.subject):null;
    const tid=question.theme?await themeId(question.theme,sid):null;
    await post('pyq_questions',[{id:question.id,workspace_id:workspaceId,year:Number(question.year),paper_id:papersByCode.get(question.paper),question_number:String(question.number||''),question_text:question.text,subject_id:sid,theme_id:tid,source_document:question.sourceDocument||null,source_page:question.sourcePage?Number(question.sourcePage):null,syllabus_area:question.area||null,question_kind:['question','case_study','essay'].includes(question.kind)?question.kind:'question',source_metadata:question.metadata&&typeof question.metadata==='object'?question.metadata:{},marks:question.marks?Number(question.marks):null,word_limit:question.wordLimit?Number(String(question.wordLimit).replace(/\D/g,''))||null:null,created_by:question.createdBy||userId,updated_by:userId}],'id');
  }
  async function saveQuestions(items) {
    const subjects=[...new Set(items.map(x=>x.subject).filter(Boolean))];
    await Promise.all(subjects.map(subjectId));
    const subjectIds=new Map(subjects.map(name=>[name,subjectsByName.get(name)]));
    const pairs=new Map();
    for(const item of items) if(item.theme&&subjectIds.get(item.subject)) pairs.set(`${subjectIds.get(item.subject)}::${norm(item.theme)}`,{workspace_id:workspaceId,subject_id:subjectIds.get(item.subject),name:item.theme});
    const missing=[...pairs].filter(([key])=>!themesByName.has(key)).map(([,row])=>row);
    for(let i=0;i<missing.length;i+=250){
      const rows=await post('themes',missing.slice(i,i+250),'subject_id,normalized_name');
      for(const row of rows||[]) themesByName.set(`${row.subject_id}::${norm(row.name)}`,row.id);
    }
    const payload=items.map(item=>{
      const sid=item.subject?subjectIds.get(item.subject):null;
      const tid=item.theme&&sid?themesByName.get(`${sid}::${norm(item.theme)}`):null;
      return {id:item.id,workspace_id:workspaceId,year:Number(item.year),paper_id:papersByCode.get(item.paper),question_number:String(item.number||''),question_text:item.text,subject_id:sid||null,theme_id:tid||null,source_document:item.sourceDocument||null,source_page:item.sourcePage?Number(item.sourcePage):null,syllabus_area:item.area||null,question_kind:['question','case_study','essay'].includes(item.kind)?item.kind:'question',source_metadata:item.metadata&&typeof item.metadata==='object'?item.metadata:{},marks:item.marks?Number(item.marks):null,word_limit:item.wordLimit?Number(String(item.wordLimit).replace(/\D/g,''))||null:null,created_by:item.createdBy||userId,updated_by:userId};
    });
    for(let i=0;i<payload.length;i+=200) await post('pyq_questions',payload.slice(i,i+200),'id');
  }
  async function setPractice(questionId,practiced,practicedAt) {
    const filter=`workspace_id=eq.${q(workspaceId)}&user_id=eq.${q(userId)}&question_id=eq.${q(questionId)}`;
    if(practiced) await post('pyq_practice',[{workspace_id:workspaceId,user_id:userId,question_id:questionId,practiced_at:practicedAt||new Date().toISOString()}],'user_id,question_id');
    else await remove('pyq_practice',filter);
  }
  async function saveAnswer(questionId,answer) {
    await post('pyq_answers',[{question_id:questionId,workspace_id:workspaceId,content:{html:answer.content||''},content_text:plain(answer.content||''),created_by:answer.createdBy||userId,updated_by:userId}],'question_id');
  }
  async function resetProgress(scope,target) {
    let value=target;
    if(scope==='paper') value=String(papersByCode.get(target)||'');
    if(scope==='subject') value=String(subjectsByName.get(target)||'');
    if(!value) throw new Error('Choose a valid reset target.');
    return api.rpc('reset_pyq_progress',{target_workspace:workspaceId,scope,target_value:String(value)});
  }
  async function syncTheme(theme) {
    return api.api(`profiles?id=eq.${q(userId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({preferences:{theme}})});
  }
  window.EdvantageData={connectUser,loadWorkspace,loadNotionNotes,loadNotionNoteContent,notionSubjects,notionCanNest,notionError,saveSubject,deleteSubject,saveNote,deleteNote,saveKeyword,saveQuestion,saveQuestions,setPractice,saveAnswer,resetProgress,syncTheme,workspace:()=>workspaceId,user:()=>userId};
})();

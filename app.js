/* ================= 喵霸天 · 工作台 - 核心逻辑 ================= */
/* 数据全部保存在本机 IndexedDB：assets(素材) / copies(文案) / tasks(计划) */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- IndexedDB ---------- */
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('workbench', 3);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('assets')) d.createObjectStore('assets',{keyPath:'id'});
      if(!d.objectStoreNames.contains('copies')) d.createObjectStore('copies',{keyPath:'id'});
      if(!d.objectStoreNames.contains('tasks'))  d.createObjectStore('tasks',{keyPath:'id'});
      if(!d.objectStoreNames.contains('ideas'))  d.createObjectStore('ideas',{keyPath:'id'});
      if(!d.objectStoreNames.contains('hots'))   d.createObjectStore('hots',{keyPath:'id'});
      if(!d.objectStoreNames.contains('attend')) d.createObjectStore('attend',{keyPath:'id'});
      if(!d.objectStoreNames.contains('hosts'))  d.createObjectStore('hosts',{keyPath:'id'});
      if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv',{keyPath:'k'});
    };
    r.onsuccess = ()=>{db=r.result;res()};
    r.onerror = ()=>rej(r.error);
  });
}
const tx = (store,mode='readonly')=>db.transaction(store,mode).objectStore(store);
const dbAll = store => new Promise((res,rej)=>{const q=tx(store).getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const dbPut = (store,val)=>new Promise((res,rej)=>{const q=tx(store,'readwrite').put(val);q.onsuccess=res;q.onerror=()=>rej(q.error)});
const dbDel = (store,key)=>new Promise((res,rej)=>{const q=tx(store,'readwrite').delete(key);q.onsuccess=res;q.onerror=()=>rej(q.error)});
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ---------- kv 键值存储（存 token 等） ---------- */
const kvGet = k=>new Promise((res,rej)=>{const q=tx('kv','readonly').get(k);q.onsuccess=()=>res(q.result?q.result.v:undefined);q.onerror=()=>rej(q.error)});
const kvPut = (k,v)=>new Promise((res,rej)=>{const q=tx('kv','readwrite').put({k,v});q.onsuccess=res;q.onerror=()=>rej(q.error)});

/* ---------- GitHub 图床 ---------- */
const GH={owner:'yingzic978-zizi',repo:'workbench-pwa',branch:'main',dir:'assets-img'};
function fileToB64(file){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.readAsDataURL(file); }); }
function compressImage(file,maxDim=1280,q=0.82){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const r=Math.min(1,maxDim/Math.max(img.width,img.height));
      const c=document.createElement('canvas'); c.width=img.width*r; c.height=img.height*r;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>res(b),'image/jpeg',q); URL.revokeObjectURL(img.src);
    };
    img.onerror=()=>res(null);
    img.src=URL.createObjectURL(file);
  });
}
async function uploadToGitHub(filename,base64,token){
  const path=`${GH.dir}/${filename}`;
  const api=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`;
  const res=await fetch(api,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:`upload ${filename}`,content:base64,branch:GH.branch})});
  if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.message||('HTTP '+res.status)); }
  const d=await res.json();
  return d.content.download_url;
}

// 文案云端同步：UTF-8 安全的 base64 编解码（GitHub Contents API 要求 content 为 base64）
function utf8ToB64(str){ const b=new TextEncoder().encode(str); let s=''; for(const x of b) s+=String.fromCharCode(x); return btoa(s); }
function b64ToUtf8(b64){ const bin=atob(b64); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i); return new TextDecoder().decode(arr); }
/* ---------- 全局状态 ---------- */
let assets=[], copies=[], tasks=[], ideas=[], hots=[], attend=[], hosts=[];
let curView='assets', assetFilter='all', catFilter='', keyword='', hotFilter='all', assetMode='file', copyFabric='';
let tagFilters=new Set();          // 多选标签筛选（AND 关系：图必须含全部选中标签）
let multiMode=false;               // 素材库多选模式
const selectedIds=new Set();       // 多选模式下被勾选的素材 id
let copyMultiMode=false;           // 文案库多选模式
const copySelectedIds=new Set();   // 多选模式下被勾选的文案 id
let selFabrics=new Set();          // 上传弹层已选中的面料（保存时拼「账号-面料」）
let pendingDel=new Set();         // 本机删过的文案 id，待云同步时写入云端 deleted 列表（跨设备传播删除意图）
// v15: 面料词库（录入文案时自动识别打标签，方便按面料筛选复制）。
// ★ 要加新面料，直接往这个数组里加一项即可（例如 '天丝','冰丝'）
const FABRICS=['纯棉','莱赛尔','莫代尔棉','云朵棉','雪花绒','半边绒','羊毛绒','夹棉'];
// 长词优先 + 命中后从文本移除，避免“莫代尔棉”被“棉”二次误抓
function detectFabrics(text){
  let t=text||''; const hit=[];
  FABRICS.slice().sort((a,b)=>b.length-a.length).forEach(f=>{
    if(t.includes(f)){ hit.push(f); t=t.split(f).join(''); }
  });
  return hit;
}
let attSort={key:'name',dir:1};
const objURLs = new Map(); // id -> objectURL 缓存

function url(item){
  if(item.kind==='link'||item.kind==='cloud') return item.url;
  if(!objURLs.has(item.id) && item.blob) objURLs.set(item.id, URL.createObjectURL(item.blob));
  return objURLs.get(item.id);
}
function thumbUrl(item){
  if(item.kind==='link'||item.kind==='cloud') return item.thumb||(item.type==='image'?item.url:null);
  if(item.thumb){
    const k='t_'+item.id;
    if(!objURLs.has(k)) objURLs.set(k, URL.createObjectURL(item.thumb));
    return objURLs.get(k);
  }
  return item.type==='image' ? url(item) : null;
}

/* ---------- 工具 ---------- */
function toast(msg,ms=2200){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),ms);
}
const fmtSize = n=>{ if(!n)return'0B'; const u=['B','KB','MB','GB']; let i=0; while(n>=1024&&i<3){n/=1024;i++} return n.toFixed(i?1:0)+u[i]; };
const todayStr = ()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const esc = s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- 视图切换 ---------- */
const titles={assets:'素材库',copy:'文案库',plan:'今日计划',ideas:'选题灵感',hot:'热点视频',attend:'考勤统计',mine:'我的 · 备份'};
$$('nav .n-item').forEach(b=>b.onclick=()=>{
  curView=b.dataset.view;
  $$('nav .n-item').forEach(x=>x.classList.toggle('on',x===b));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+curView));
  $('#pageTitle').textContent=titles[curView];
  $('#searchWrap').style.display = (curView==='mine'||curView==='attend')?'none':'flex';
  $('#fab').style.display = (curView==='mine')?'none':'flex';
  if(curView!=='assets' && multiMode){ multiMode=false; selectedIds.clear(); }
  if(curView!=='copy' && copyMultiMode){ copyMultiMode=false; copySelectedIds.clear(); }
  render();
});
$('#searchInput').oninput = e=>{ keyword=e.target.value.trim().toLowerCase(); render(); };

/* ---------- 弹层控制 ---------- */
function openSheet(id){ $('#mask').classList.add('show'); $(id).classList.add('show'); }
function closeSheets(){ $('#mask').classList.remove('show'); $$('.sheet').forEach(s=>s.classList.remove('show')); }
$('#mask').onclick=closeSheets;
$('#fab').onclick=()=>{
  if(curView==='assets'){ pickedFiles=[]; $('#pickPreview').innerHTML=''; $('#filePick').value=''; $('#aCat').value=catFilter||''; resetAssetTagInputs(); assetMode='file'; document.querySelectorAll('#sheetAsset .seg button').forEach(x=>x.classList.toggle('on',x.dataset.m==='file')); $('#assetFilePanel').style.display='block'; $('#assetLinkPanel').style.display='none'; $('#assetCloudRow').style.display='flex'; $('#aUrl').value=''; $('#aName').value=''; $('#aThumb').value=''; renderCatList(); openSheet('#sheetAsset'); }
  else if(curView==='copy'){ editCopyId=null; $('#copySheetTitle').textContent='新建文案'; $('#cTitle').value=''; $('#cBody').value=''; $('#cTags').value=''; refreshFabricHint(); openSheet('#sheetCopy'); }
  else if(curView==='plan'){ $('#tTitle').value=''; $('#tDate').value=todayStr(); $('#tTime').value=''; $('#tRepeat').value='none'; openSheet('#sheetTask'); }
  else if(curView==='ideas'){ editIdeaId=null; $('#ideaSheetTitle').textContent='添加选题'; $('#iBody').value=''; $('#iTags').value=''; openSheet('#sheetIdea'); }
  else if(curView==='hot'){ editHotId=null; $('#hotSheetTitle').textContent='收藏热点视频'; $('#hTitle').value=''; $('#hUrl').value=''; $('#hPlat').value='抖音'; $('#hStatus').value='ref'; $('#hNote').value=''; openSheet('#sheetHot'); }
  else if(curView==='attend'){ $('#attSheetTitle').textContent='添加考勤'; $('#attDate').value=todayStr(); $('#attNote').value=''; refreshAttPreview(); openSheet('#sheetAtt'); }
};

/* ================= 素材库 ================= */
let pickedFiles=[];
document.querySelectorAll('#sheetAsset .seg button').forEach(b=>b.onclick=()=>{
  assetMode=b.dataset.m;
  document.querySelectorAll('#sheetAsset .seg button').forEach(x=>x.classList.toggle('on',x===b));
  $('#assetFilePanel').style.display = assetMode==='file'?'block':'none';
  $('#assetLinkPanel').style.display = assetMode==='link'?'block':'none';
  const cr=$('#assetCloudRow'); if(cr) cr.style.display = assetMode==='file'?'flex':'none';
});
$('#filePick').onchange = e=>{
  pickedFiles=[...e.target.files];
  const pv=$('#pickPreview'); pv.innerHTML='';
  pickedFiles.forEach(f=>{
    if(f.type.startsWith('image/')){
      const img=document.createElement('img'); img.className='pv'; img.src=URL.createObjectURL(f); pv.appendChild(img);
    }else{
      const d=document.createElement('div'); d.className='pv'; d.textContent=f.type.startsWith('video/')?'🎬':'📄'; pv.appendChild(d);
    }
  });
};

function makeImageThumb(file){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas'); const m=360;
      const r=Math.min(m/img.width,m/img.height,1);
      c.width=img.width*r; c.height=img.height*r;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>res(b),'image/jpeg',.75);
      URL.revokeObjectURL(img.src);
    };
    img.onerror=()=>res(null);
    img.src=URL.createObjectURL(file);
  });
}
function makeVideoThumb(file){
  return new Promise(res=>{
    const v=document.createElement('video');
    v.muted=true; v.playsInline=true; v.preload='metadata';
    v.src=URL.createObjectURL(file);
    let done=false;
    const finish=b=>{ if(done)return; done=true; URL.revokeObjectURL(v.src); res(b); };
    v.onloadeddata=()=>{ v.currentTime=Math.min(0.5, (v.duration||1)/2); };
    v.onseeked=()=>{
      try{
        const c=document.createElement('canvas'); const m=360;
        const r=Math.min(m/v.videoWidth,m/v.videoHeight,1);
        c.width=v.videoWidth*r; c.height=v.videoHeight*r;
        c.getContext('2d').drawImage(v,0,0,c.width,c.height);
        c.toBlob(b=>finish(b),'image/jpeg',.7);
      }catch(e){ finish(null); }
    };
    v.onerror=()=>finish(null);
    setTimeout(()=>finish(null),4000);
  });
}

$('#aSave').onclick = async ()=>{
  const tagArr=buildAssetTags();
  if(assetMode==='link'){
    const u=$('#aUrl').value.trim();
    if(!u) return toast('先粘贴素材链接');
    const type=$('#aLinkType').value;
    const name=$('#aName').value.trim() || u.split('/').pop().split('?')[0] || '未命名链接';
    const cat=$('#aCat').value.trim();
    const tags=tagArr;
    const thumb=$('#aThumb').value.trim()||null;
    await dbPut('assets',{id:uid(),name,type,kind:'link',url:u,thumb,cat,tags,size:0,created:Date.now()});
    closeSheets(); await load(); render(); resetAssetTagInputs(); toast('链接素材已保存');
    return;
  }
  if(!pickedFiles.length) return toast('请先选择文件');
  const cat=$('#aCat').value.trim();
  const token = $('#ghToken').value.trim() || await kvGet('gh_token');
  const useCloud = $('#aCloud').checked && !!token;
  if($('#aCloud').checked && !token) toast('未配置 GitHub Token，已转存本地');
  $('#aSave').disabled=true; $('#aSave').textContent='保存中…';
  let cloudOk=0, localOk=0, cloudErr=null;
  const total=pickedFiles.length; let done=0;
  for(const f of pickedFiles){
    done++; $('#aSave').textContent=`保存中 ${done}/${total}…`;
    const type = f.type.startsWith('image/')?'image':f.type.startsWith('video/')?'video':'file';
    if(useCloud && type==='image'){
      try{
        let blob=f;
        const cp=await compressImage(f); if(cp) blob=cp;
        const b64=await fileToB64(blob);
        const ext='.'+(f.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9.]/g,'');
        const u=await uploadToGitHub(uid()+ext, b64, token);
        await dbPut('assets',{id:uid(),name:f.name,type,mime:f.type,size:blob.size,cat,tags:tagArr,kind:'cloud',url:u,thumb:u,created:Date.now()});
        cloudOk++; continue;
      }catch(e){ cloudErr=e.message; console.error('[GitHub cloud upload failed]', e); }
    }
    let thumb=null;
    if(type==='image') thumb=await makeImageThumb(f);
    if(type==='video') thumb=await makeVideoThumb(f);
    await dbPut('assets',{id:uid(),name:f.name,type,mime:f.type,size:f.size,cat,tags:tagArr,blob:f,thumb,created:Date.now()});
    localOk++;
  }
  $('#aSave').disabled=false; $('#aSave').textContent='保存到素材库';
  resetAssetTagInputs();
  closeSheets(); await load(); render();
  const sum=`已保存 ${cloudOk?cloudOk+' 张云端 ':''}${localOk?localOk+' 张本地':''}素材`;
  toast(cloudErr?`❌ 云端失败：${cloudErr}（已转本地）— ${sum}`:sum, cloudErr?5500:2200);
};

function renderCatList(){
  const cats=[...new Set(assets.map(a=>a.cat).filter(Boolean))];
  $('#catList').innerHTML=cats.map(c=>`<option value="${esc(c)}">`).join('');
}

function matchAsset(a){
  if(assetFilter!=='all' && a.type!==assetFilter) return false;
  if(catFilter && a.cat!==catFilter) return false;
  if(tagFilters.size){
    for(const t of tagFilters){ if(!a.tags.includes(t)) return false; }
  }
  if(keyword){
    const hay=(a.name+' '+(a.cat||'')+' '+a.tags.join(' ')).toLowerCase();
    if(!hay.includes(keyword)) return false;
  }
  return true;
}

/* ---- 标签 chips 二级筛选 ---- */
function renderTagBar(){
  const counts=new Map();
  for(const a of assets){
    if(assetFilter!=='all' && a.type!==assetFilter) continue;
    for(const t of a.tags){ counts.set(t,(counts.get(t)||0)+1); }
  }
  // 出现次数倒序，最多 18 个
  const list=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18);
  const tb=$('#tagBar');
  if(!list.length){ tb.classList.add('hidden'); return; }
  tb.classList.remove('hidden');
  tb.innerHTML=list.map(([t,c])=>`<div class="chip ${tagFilters.has(t)?'on':''}" data-t="${esc(t)}">#${esc(t)} <span style="opacity:.5">${c}</span></div>`).join('');
  tb.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
    const t=ch.dataset.t;
    if(tagFilters.has(t)) tagFilters.delete(t); else tagFilters.add(t);
    render();
  });
}

function renderAssets(){
  // 分类 chips
  const cats=[...new Set(assets.map(a=>a.cat).filter(Boolean))];
  const cc=$('#catChips');
  if(cats.length){
    cc.classList.remove('hidden');
    cc.innerHTML=`<div class="chip ${!catFilter?'on':''}" data-c="">全部分类</div>`+cats.map(c=>`<div class="chip ${catFilter===c?'on':''}" data-c="${esc(c)}">${esc(c)}</div>`).join('');
    cc.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{catFilter=ch.dataset.c;render();});
  }else{ cc.classList.add('hidden'); catFilter=''; }

  // 标签 chips
  renderTagBar();

  const list=assets.filter(matchAsset).sort((a,b)=>b.created-a.created);
  const g=$('#assetGrid'); g.innerHTML='';
  $('#assetEmpty').classList.toggle('hidden', assets.length>0);
  list.forEach(a=>{
    const d=document.createElement('div'); d.className='g-item'+(multiMode?' multi':'')+(selectedIds.has(a.id)?' sel':'');
    d.dataset.id=a.id;
    // 图片
    if(a.kind==='link'){
      const tu=thumbUrl(a);
      if(tu) d.innerHTML=`<img src="${tu}" loading="lazy">`;
      else if(a.type==='video') d.innerHTML=`<div class="g-file">🔗<span>${esc(a.name)}</span></div>`;
      else if(a.type==='image') d.innerHTML=`<div class="g-file">🌐<span>${esc(a.name)}</span></div>`;
      else d.innerHTML=`<div class="g-file">🔗<span>${esc(a.name)}</span></div>`;
      d.innerHTML+=`<div class="g-badge">🔗 链接</div>`;
    }else{
      const tu=thumbUrl(a);
      if(tu) d.innerHTML=`<img src="${tu}" loading="lazy">`;
      else if(a.type==='video') d.innerHTML=`<div class="g-file">🎬<span>${esc(a.name)}</span></div>`;
      else d.innerHTML=`<div class="g-file">📄<span>${esc(a.name)}</span></div>`;
      if(a.type==='video') d.innerHTML+=`<div class="g-badge">▶ 视频</div>`;
      if(a.kind==='cloud') d.innerHTML+=`<div class="g-badge">☁ 云端</div>`;
    }
    // 多选勾选圈
    if(multiMode){
      d.innerHTML+=`<div class="g-check ${selectedIds.has(a.id)?'on':''}">${selectedIds.has(a.id)?'✓':''}</div>`;
    }
    // 底部名称 + 标签（标签可点击筛选）
    let nameHtml=`<span class="g-name-text">${esc(a.name)}</span>`;
    if(a.tags && a.tags.length){
      const shown=a.tags.slice(0,2);
      const more=a.tags.length-shown.length;
      nameHtml+=`<div class="g-tags">${shown.map(t=>`<span class="g-tag" data-t="${esc(t)}">#${esc(t)}</span>`).join('')}${more>0?`<span class="g-tag more">+${more}</span>`:''}</div>`;
    }
    d.innerHTML+=`<div class="g-name">${nameHtml}</div>`;
    // 事件：长按进多选 / 普通点开预览 / 多选下点 = 切换
    attachItemEvents(d,a);
    g.appendChild(d);
  });
  if(assets.length && !list.length){
    g.innerHTML='<div class="empty" style="grid-column:1/-1">没有匹配的素材</div>';
  }
  // 批量栏
  updateBatchBar();
}

/* 单图事件绑定（长按进入多选 / 点开预览 / 多选切换 / 点标签筛选） */
let pressTimer=null, pressTriggered=false;
function attachItemEvents(d,a){
  d.oncontextmenu=e=>e.preventDefault();
  d.onpointerdown=e=>{
    if(e.target.classList.contains('g-tag')) return;   // 点标签不触发长按
    pressTriggered=false;
    pressTimer=setTimeout(()=>{
      pressTriggered=true;
      if(!multiMode) toggleMulti(true);
      if(!selectedIds.has(a.id)){ selectedIds.add(a.id); }
      render(); navigator.vibrate?.(15);
    },500);
  };
  d.onpointerup=d.onpointerleave=d.onpointercancel=()=>{ clearTimeout(pressTimer); };
  d.onclick=e=>{
    if(pressTriggered){ pressTriggered=false; return; }
    // 点标签 chip：进入筛选
    const tagEl=e.target.closest('.g-tag');
    if(tagEl && !tagEl.classList.contains('more')){
      const t=tagEl.dataset.t;
      if(tagFilters.has(t)) tagFilters.delete(t); else tagFilters.add(t);
      render();
      return;
    }
    if(multiMode){
      if(selectedIds.has(a.id)) selectedIds.delete(a.id); else selectedIds.add(a.id);
      render();
    }else{
      openPreview(a);
    }
  };
}

$('#assetChips').querySelectorAll('.chip').forEach(c=>{
  if(c.id==='multiBtn') return;   // 多选按钮单独绑定
  c.onclick=()=>{
    const f=c.dataset.f;
    assetFilter = (assetFilter===f) ? 'all' : f;   // 再点一次取消筛选，回到全部
    $('#assetChips').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on', x===c && assetFilter===f));
    render();
  };
});
$('#multiBtn').onclick=()=>toggleMulti(!multiMode);
$('#bCancel').onclick=()=>toggleMulti(false);
$('#bDel').onclick=batchDelete;

/* ---- 多选 / 批量删除 ---- */
function toggleMulti(on){
  multiMode=on;
  $('#multiBtn').classList.toggle('on',on);
  $('#multiBtn').textContent=on?'☑ 多选中':'☑ 多选';
  if(!on) selectedIds.clear();
  render();
}
function updateBatchBar(){
  const bar=$('#batchBar');
  if(!bar) return;
  if(!multiMode){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#bCnt').textContent=selectedIds.size;
  $('#bDel').disabled=selectedIds.size===0;
  $('#bDel').style.opacity=selectedIds.size===0?.4:1;
}
async function batchDelete(){
  if(!selectedIds.size) return;
  const items=assets.filter(a=>selectedIds.has(a.id));
  const cloudCount=items.filter(a=>a.kind==='cloud').length;
  const localCount=items.length-cloudCount;
  const tip=`确定删除 ${items.length} 张素材吗？\n`
    +(cloudCount?`· ${cloudCount} 张为云端文件，将同步删除云端，其他设备拉取后也会消失\n`:'')
    +(localCount?`· ${localCount} 张仅本机删除\n`:'');
  if(!confirm(tip.trim())) return;

  // 先并行删云端（所有图同时发请求，速度 N 倍）
  if(cloudCount){
    const cloudItems=items.filter(a=>a.kind==='cloud');
    toast(`正在删除云端 ${cloudItems.length} 张…`);
    const results=await Promise.all(cloudItems.map(async a=>{
      try{ await deleteFromCloud(a); return {a,ok:true}; }
      catch(e){ console.error('[batchDelete cloud]',a.name,e); return {a,ok:false,err:e}; }
    }));
    const failed=results.filter(r=>!r.ok);
    if(failed.length) toast(`云端删除：${cloudItems.length-failed.length} 成功 ${failed.length} 失败（仅成功的已同步）`);
  }

  // 再删本机
  for(const a of items){ await dbDel('assets',a.id); objURLs.delete(a.id); objURLs.delete('t_'+a.id); }
  selectedIds.clear();
  toggleMulti(false);
  await load(); render();
  toast(`✅ 已删除 ${items.length} 张`);
}

/* ---- 预览 ---- */
let previewItem=null;
function openPreview(a){
  previewItem=a;
  const b=$('#pvBody'); b.innerHTML='';
  $('#pvInfo').innerHTML=`<div class="t">${esc(a.name)}</div><div class="s">${a.cat?esc(a.cat)+' · ':''}${fmtSize(a.size)}${a.tags.length?' · '+esc(a.tags.join(' ')):''}</div>`;
  if(a.type==='image') b.innerHTML=`<img src="${url(a)}">`;
  else if(a.type==='video') b.innerHTML=`<video src="${url(a)}" controls playsinline autoplay></video>`;
  else if(a.kind==='link') b.innerHTML=`<div class="pv-doc">🔗 外部链接<br>${esc(a.name)}<br><br><a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">打开链接</a></div>`;
  else b.innerHTML=`<div class="pv-doc">📄<br>${esc(a.name)}<br>${fmtSize(a.size)}<br><br>点击下方「保存到手机」下载查看</div>`;
  $('#previewer').classList.add('show');
}
function closePreview(){ $('#previewer').classList.remove('show'); $('#pvBody').innerHTML=''; }
$('#pvDownload').onclick=()=>{
  if(!previewItem)return;
  if(previewItem.kind==='link'){ window.open(previewItem.url,'_blank'); return; }
  const a=document.createElement('a'); a.href=url(previewItem); a.download=previewItem.name; a.click();
};
$('#pvDelete').onclick=async ()=>{
  if(!previewItem)return;
  const tip = previewItem.kind==='cloud'
    ? '确定删除「'+previewItem.name+'」吗？\n（将同时删除云端文件，其他设备拉取后也会消失）'
    : '确定删除「'+previewItem.name+'」吗？';
  if(!confirm(tip))return;
  let msg='已删除';
  if(previewItem.kind==='cloud'){
    try{
      await deleteFromCloud(previewItem);
      msg='已删除（云端+本机同步）';
    }catch(e){
      toast('云端删除失败：'+e.message+'（本机未删除）');
      console.error('[deleteFromCloud]',e);
      return;
    }
  }
  await dbDel('assets',previewItem.id);
  objURLs.delete(previewItem.id); objURLs.delete('t_'+previewItem.id);
  closePreview(); await load(); render(); toast(msg);
};

/* ================= 文案库 ================= */
let editCopyId=null;
$('#cSave').onclick=async ()=>{
  const title=$('#cTitle').value.trim(), body=$('#cBody').value;
  if(!title && !body.trim()) return toast('写点内容再保存吧');
  const manualTags=$('#cTags').value.trim().split(/\s+/).filter(Boolean);
  const autoFab=detectFabrics(title+' '+body);            // 自动识别面料
  const tags=[...new Set([...manualTags, ...autoFab])];  // 合并去重
  const old=editCopyId?copies.find(c=>c.id===editCopyId):null;
  await dbPut('copies',{id:editCopyId||uid(),title:title||'未命名文案',body,tags,created:old?old.created:Date.now(),updated:Date.now()});
  closeSheets(); await load(); render();
  toast('文案已保存'+(autoFab.length?'（面料：'+autoFab.join('、')+'）':''));
};
function renderCopies(){
  ensureFabricTags();
  initFabricChips();   // chips 跟着当前文案动态生成（新面料自动出现）
  const list=copies.filter(c=>{
    const okKw=!keyword||(c.title+' '+c.body+' '+(c.tags||[]).join(' ')).toLowerCase().includes(keyword);
    const okFab=!copyFabric||(c.tags||[]).includes(copyFabric);
    return okKw&&okFab;
  }).sort((a,b)=>b.updated-a.updated);
  const box=$('#copyList'); box.innerHTML='';
  $('#copyEmpty').classList.toggle('hidden',copies.length>0);
  list.forEach(c=>{
    const d=document.createElement('div');
    d.className='card'+(copyMultiMode?' multi':'')+(copySelectedIds.has(c.id)?' sel':'');
    d.innerHTML=`<div class="copy-title"><span>${esc(c.title||'未命名')}</span></div>
      <div class="copy-body">${esc(c.body)}</div>
      ${c.tags.length?`<div class="tags">${c.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
      <div class="row-actions"><span data-act="copy">📋 复制</span><span data-act="edit">✏️ 编辑</span><span class="del" data-act="del">🗑 删除</span></div>`;
    if(copyMultiMode) d.innerHTML += `<div class="copy-check ${copySelectedIds.has(c.id)?'on':''}">${copySelectedIds.has(c.id)?'✓':''}</div>`;
    d.querySelector('[data-act=copy]').onclick=async e=>{
      e.stopPropagation();
      try{ await navigator.clipboard.writeText(c.body); toast('已复制到剪贴板'); }
      catch(err){ toast('复制失败，请长按文本手动复制'); }
    };
    d.querySelector('[data-act=edit]').onclick=()=>{ editCopyId=c.id; $('#copySheetTitle').textContent='编辑文案'; $('#cTitle').value=c.title; $('#cBody').value=c.body; $('#cTags').value=(c.tags||[]).join(' '); refreshFabricHint(); openSheet('#sheetCopy'); };
    d.querySelector('[data-act=del]').onclick=async ()=>{ if(!confirm('删除这条文案？'))return; await delCopy(c.id); await load(); render(); };
    attachCopyEvents(d,c);
    box.appendChild(d);
  });
  if(copies.length&&!list.length) box.innerHTML='<div class="empty">没有匹配的文案</div>';
  updateCopyBatchBar();
}
/* 文案卡片事件：长按 500ms 进多选 + 选中 + 震动；多选模式点卡片切换选中；按钮区不触发 */
function attachCopyEvents(d,c){
  let timer=null, triggered=false;
  d.oncontextmenu=e=>e.preventDefault();
  d.onpointerdown=e=>{
    if(e.target.closest('.row-actions')) return;     // 编辑/删除按钮不触发长按
    triggered=false;
    timer=setTimeout(()=>{
      triggered=true;
      if(!copyMultiMode) toggleCopyMulti(true);
      if(!copySelectedIds.has(c.id)) copySelectedIds.add(c.id);
      renderCopies(); navigator.vibrate?.(15);
    },500);
  };
  d.onpointerup=d.onpointerleave=d.onpointercancel=()=>{ clearTimeout(timer); };
  d.onclick=e=>{
    if(triggered){ triggered=false; return; }
    if(copyMultiMode){
      if(e.target.closest('.row-actions')) return;
      if(copySelectedIds.has(c.id)) copySelectedIds.delete(c.id); else copySelectedIds.add(c.id);
      renderCopies();
    }
  };
}
function updateCopyBatchBar(){
  const bar=$('#copyBatchBar');
  if(!bar) return;
  if(!copyMultiMode){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#copyBCnt').textContent=copySelectedIds.size;
  const btn=$('#copyBDel');
  btn.disabled=copySelectedIds.size===0;
  btn.style.opacity=copySelectedIds.size===0?.4:1;
}
function toggleCopyMulti(on){
  copyMultiMode=on;
  $('#copyMultiBtn').classList.toggle('on',on);
  $('#copyMultiBtn').textContent=on?'☑ 多选中':'☑ 多选';
  if(!on) copySelectedIds.clear();
  renderCopies();
}
async function batchDeleteCopies(){
  if(!copySelectedIds.size) return;
  const items=copies.filter(c=>copySelectedIds.has(c.id));
  if(!confirm(`确定删除选中的 ${items.length} 条文案？`)) return;
  await Promise.all(items.map(c=>delCopy(c.id)));
  toast(`已删除 ${items.length} 条文案`);
  copySelectedIds.clear();
  await load(); render();
}
$('#copyMultiBtn').onclick=()=>toggleCopyMulti(!copyMultiMode);
$('#copyBCancel').onclick=()=>toggleCopyMulti(false);
$('#copyBDel').onclick=batchDeleteCopies;

/* ================= 文案面料：动态 chips（从 copies.tags 实时收集，新面料自动出现） ================= */
// 从所有文案的 tags 中去重收集；FABRICS 词库里的面料排前面，其他按使用频次倒序
function collectCopyFabrics(){
  const set=new Set();
  copies.forEach(c=>(c.tags||[]).forEach(t=>{ if(t) set.add(t); }));
  // 频次统计
  const cnt={};
  copies.forEach(c=>(c.tags||[]).forEach(t=>{ cnt[t]=(cnt[t]||0)+1; }));
  const arr=[...set];
  arr.sort((a,b)=>{
    const ai=FABRICS.indexOf(a), bi=FABRICS.indexOf(b);
    if(ai!==-1||bi!==-1) return (ai===-1?99:ai)-(bi===-1?99:bi);
    if((cnt[b]||0)!==(cnt[a]||0)) return (cnt[b]||0)-(cnt[a]||0);
    return a.localeCompare(b,'zh-Hans-CN');
  });
  return arr;
}
function initFabricChips(){
  const box=$('#fabricChips'); if(!box) return;
  box.innerHTML='';
  const list=collectCopyFabrics();
  if(!list.length){
    const empty=document.createElement('div');
    empty.className='chips-empty';
    empty.textContent='暂无标签 · 新建/导入文案时按面料词自动打标签';
    box.appendChild(empty);
    return;
  }
  list.forEach(f=>{
    const d=document.createElement('div');
    d.className='chip';
    d.dataset.f=f;
    d.textContent=f;
    box.appendChild(d);
  });
  box.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
    // 再点同一个 chip → 取消过滤（回到全部）
    if(copyFabric===ch.dataset.f){ copyFabric=''; ch.classList.remove('on'); renderCopies(); return; }
    copyFabric=ch.dataset.f;
    box.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===ch));
    renderCopies();
  });
  // 初始：刷新"on"高亮状态
  box.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on', x.dataset.f===copyFabric));
}
function initAssetFabricChips(){
  const box=$('#assetFabricChips'); if(!box) return;
  box.innerHTML='';
  selFabrics.clear();
  FABRICS.forEach(f=>{
    const d=document.createElement('div'); d.className='chip'; d.dataset.f=f; d.textContent=f;
    d.onclick=()=>{
      if(selFabrics.has(f)){ selFabrics.delete(f); d.classList.remove('on'); }
      else { selFabrics.add(f); d.classList.add('on'); }
    };
    box.appendChild(d);
  });
}
// 上传弹层标签：账号 + 选中面料 → 「账号-面料」，并与手动标签合并去重
function buildAssetTags(){
  const extra=$('#aTags').value.trim().split(/\s+/).filter(Boolean);
  const account=$('#aAccount').value.trim();
  const set=new Set(extra);
  selFabrics.forEach(f=> set.add(account? `${account}-${f}` : f));
  return [...set];
}
function resetAssetTagInputs(){
  $('#aTags').value=''; $('#aAccount').value=''; selFabrics.clear(); initAssetFabricChips();
}
function refreshFabricHint(){
  const el=$('#fabricHint'); if(!el) return;
  const hit=detectFabrics($('#cTitle').value+' '+$('#cBody').value);
  if(hit.length){ el.textContent='已识别面料：'+hit.map(f=>'#'+f).join('  '); el.classList.add('has'); }
  else { el.textContent='未识别到面料词（录入内容含面料会自动加标签）'; el.classList.remove('has'); }
}
// 给没有面料标签的文案自动补（幂等），写到 IndexedDB 后重渲染
async function ensureFabricTags(){
  let changed=0;
  for(const c of copies){
    if(!(c.tags||[]).some(t=>FABRICS.includes(t))){
      const hit=detectFabrics((c.title||'')+' '+(c.body||''));
      if(hit.length){
        c.tags=[...new Set([...(c.tags||[]), ...hit])];
        await dbPut('copies',c);
        changed++;
      }
    }
  }
  return changed;
}
$('#cTitle').oninput=refreshFabricHint;
$('#cBody').oninput=refreshFabricHint;
initFabricChips();
initAssetFabricChips();
refreshFabricHint();

/* ================= 计划 / 提醒 ================= */
$('#tSave').onclick=async ()=>{
  const title=$('#tTitle').value.trim();
  if(!title) return toast('先写下要做什么');
  const t={id:uid(),title,date:$('#tDate').value||todayStr(),time:$('#tTime').value||'',repeat:$('#tRepeat').value,done:false,doneDates:[],created:Date.now()};
  await dbPut('tasks',t);
  closeSheets(); await load(); render(); scheduleCheck(); toast('计划已添加'+(t.time?'，到点提醒你':''));
};
const isDoneToday = t => t.repeat==='daily' ? (t.doneDates||[]).includes(todayStr()) : t.done;
async function toggleTask(t){
  if(t.repeat==='daily'){
    t.doneDates=t.doneDates||[];
    const i=t.doneDates.indexOf(todayStr());
    i>=0?t.doneDates.splice(i,1):t.doneDates.push(todayStr());
  }else t.done=!t.done;
  await dbPut('tasks',t); await load(); render();
}
function renderPlans(){
  const today=todayStr();
  const list=tasks.filter(t=>!keyword||t.title.toLowerCase().includes(keyword));
  const groups={overdue:[],today:[],future:[],doneOld:[]};
  list.forEach(t=>{
    if(t.repeat==='daily'){ groups.today.push(t); return; }
    if(t.date<today && !t.done) groups.overdue.push(t);
    else if(t.date===today) groups.today.push(t);
    else if(t.date>today) groups.future.push(t);
    else groups.doneOld.push(t);
  });
  const box=$('#planList'); box.innerHTML='';
  $('#planEmpty').classList.toggle('hidden',tasks.length>0);
  const sec=(name,arr,cls)=>{
    if(!arr.length)return;
    box.insertAdjacentHTML('beforeend',`<div class="plan-group">${name}</div>`);
    arr.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).forEach(t=>{
      const d=document.createElement('div'); d.className='task'+(isDoneToday(t)?' done':'');
      d.innerHTML=`<div class="t-check"></div><div class="t-main"><div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${t.repeat==='daily'?'<span class="rep">🔁 每天</span>':`<span class="${cls==='overdue'?'late':''}">${t.date}</span>`}${t.time?`<span>⏰ ${t.time}</span>`:''}</div></div>
        <div class="t-del">✕</div>`;
      d.querySelector('.t-check').parentElement.onclick=e=>{ if(e.target.classList.contains('t-del'))return; toggleTask(t); };
      d.querySelector('.t-del').onclick=async e=>{ e.stopPropagation(); if(!confirm('删除这条计划？'))return; await dbDel('tasks',t.id); await load(); render(); };
      box.appendChild(d);
    });
  };
  sec('⚠️ 已逾期',groups.overdue,'overdue');
  sec('📌 今天',groups.today);
  sec('🗓️ 以后',groups.future);
  sec('✅ 已完成（历史）',groups.doneOld.slice(0,20));
}

/* ---- 提醒通知 ---- */
function askNotify(){
  if(!('Notification' in window)) return toast('当前浏览器不支持通知。iPhone 需先「添加到主屏幕」后从桌面打开');
  Notification.requestPermission().then(p=>{
    $('#notifyState').textContent = p==='granted'?'已开启 ✓ 应用打开时到点会提醒':'未授权，无法弹出提醒';
    toast(p==='granted'?'提醒已开启':'你拒绝了通知权限');
  });
}
const notified=new Set(JSON.parse(localStorage.getItem('notified')||'[]'));
function scheduleCheck(){
  const now=new Date();
  const hm=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const today=todayStr();
  tasks.forEach(t=>{
    if(!t.time||isDoneToday(t))return;
    const due=(t.repeat==='daily'||t.date===today)&&t.time<=hm;
    const key=t.id+'_'+today;
    if(due&&!notified.has(key)){
      notified.add(key);
      localStorage.setItem('notified',JSON.stringify([...notified].slice(-200)));
      if('Notification' in window&&Notification.permission==='granted'){
        try{ navigator.serviceWorker?.ready.then(r=>r.showNotification('⏰ 工作提醒',{body:t.title,tag:key})); }catch(e){ new Notification('⏰ 工作提醒',{body:t.title}); }
      }
      toast('⏰ 该做了：'+t.title);
    }
  });
}
setInterval(()=>{ scheduleCheck(); },30000);

/* ================= 选题灵感 ================= */
const SPARKS=[
 '新品开箱：第一视角拆包装，突出质感细节','工厂/仓库实拍：让客户看到实力','产品前后对比：使用前 vs 使用后',
 '客户好评截图合集 + 真实反馈讲述','一分钟教程：产品的正确使用方法','避坑指南：买这类产品最容易踩的3个坑',
 '价格拆解：为什么我们敢卖这个价','同行对比测评（不点名），突出差异点','幕后花絮：打包发货的一天',
 '答疑合集：评论区问得最多的5个问题','场景种草：产品在真实生活场景里的样子','限时活动预告：3秒钩子+倒计时',
 '老板/主理人出镜：创业故事讲一段','产品极限测试：暴力测试抓眼球','买家秀翻车 vs 正确打开方式',
 '一件代发/批发流程全公开','今日发货实况：堆成山的快递','新款剧透：只露一角吊胃口',
 '行业冷知识：99%的人不知道的小知识','用数据说话：卖爆的一款，回购率多少','搭配推荐：这样组合买最划算',
 '仓库寻宝：随机抽一件半价','客户案例故事：他是怎么用我们产品赚钱的','节日热点借势：结合最近的节日拍一条',
 '拟人化产品自述：我是一件被买走的…','挑战类：连续7天每天上新一款','高频对比：9.9的和99的差在哪',
 '过程满足向：打包/贴标/封箱解压视频','店铺日常vlog：早上开门到晚上打烊','蹭热点BGM：用当下最火的音乐拍产品'
];
let editIdeaId=null, sparkSeed=0;
let sparkPlatform='all';
const PF_COLORS={'抖音':'#fe2c55','小红书':'#ff2442','淘宝':'#ff5000','微博':'#e6162d','快手':'#ff4906','综合':'#6c5ce7'};
async function renderSparks(){
  const box=$('#sparkList'); box.innerHTML='<div class="spark-loading">正在拉取今日灵感…</div>';
  let items=null;
  try{
    const res=await fetch('inspirations.json?t='+Date.now());
    if(res.ok){ const data=await res.json(); items=data.items||[]; }
  }catch(e){ items=null; }
  box.innerHTML='';
  if(!items||!items.length){
    // 离线降级：用本地题库顶上，保证有内容
    const day=Math.floor(Date.now()/86400000);
    for(let i=0;i<3;i++){
      const idx=(day*3+i+sparkSeed*7)%SPARKS.length;
      addSparkItem(box, SPARKS[idx], null);
    }
    const tip=document.createElement('div'); tip.className='spark-err';
    tip.textContent='（联网灵感暂时拉取不到，已显示离线灵感，点刷新重试）';
    box.appendChild(tip);
    return;
  }
  if(sparkPlatform!=='all') items=items.filter(x=>x.platform===sparkPlatform);
  if(!items.length){
    box.innerHTML='<div class="spark-err">该平台暂时没有灵感，点其他平台看看</div>';
    return;
  }
  items.forEach(it=> addSparkItem(box, it.body||it.title, it));
}
function addSparkItem(box, text, it){
  const d=document.createElement('div'); d.className='spark-item';
  const pf = it&&it.platform ? `<span class="pf-badge" style="background:${PF_COLORS[it.platform]||'#999'}">${esc(it.platform)}</span>` : '';
  const src = it&&it.source ? `<span class="spark-src">${esc(it.source)}</span>` : '';
  const date = it&&it.date ? `<span class="spark-date">${esc(it.date)}</span>` : '';
  const link = it&&it.url ? ` <a class="spark-src" href="${esc(it.url)}" target="_blank" rel="noopener">查看来源</a>` : '';
  d.innerHTML=`<div class="spark-main"><span class="spark-text">${esc(text)}</span><div class="spark-meta">${pf}${src}${date}${link}</div></div><span class="add">＋ 存为选题</span>`;
  d.querySelector('.add').onclick=async ()=>{
    const tags=['灵感'];
    if(it&&Array.isArray(it.tags)) it.tags.forEach(t=>{ if(!tags.includes(t)) tags.push(t); });
    await dbPut('ideas',{id:uid(),body:text,tags,used:false,created:Date.now()});
    await load(); render(); toast('已加入选题库');
  };
  box.appendChild(d);
}
$('#sparkRefresh').onclick=()=>{ renderSparks(); };
$('#pfChips').querySelectorAll('.pf-chip').forEach(c=>c.onclick=()=>{
  sparkPlatform=c.dataset.pf;
  $('#pfChips').querySelectorAll('.pf-chip').forEach(x=>x.classList.toggle('on',x===c));
  renderSparks();
});
$('#iSave').onclick=async ()=>{
  const body=$('#iBody').value.trim();
  if(!body) return toast('先写下选题内容');
  const tags=$('#iTags').value.trim().split(/\s+/).filter(Boolean);
  const old=editIdeaId?ideas.find(x=>x.id===editIdeaId):null;
  await dbPut('ideas',{id:editIdeaId||uid(),body,tags,used:old?old.used:false,created:old?old.created:Date.now()});
  closeSheets(); await load(); render(); toast('选题已保存');
};
function renderIdeas(){
  renderSparks();
  const list=ideas.filter(i=>!keyword||(i.body+' '+i.tags.join(' ')).toLowerCase().includes(keyword)).sort((a,b)=>(a.used-b.used)||(b.created-a.created));
  const box=$('#ideaList'); box.innerHTML='';
  $('#ideaEmpty').classList.toggle('hidden',ideas.length>0);
  list.forEach(i=>{
    const d=document.createElement('div'); d.className='card';
    d.innerHTML=`<div class="copy-title"><span style="font-weight:500;font-size:14px;line-height:1.5">${esc(i.body)}</span><span class="idea-status ${i.used?'used':''}">${i.used?'已用':'待用'}</span></div>
      ${i.tags.length?`<div class="tags">${i.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
      <div class="row-actions"><span data-a="use">${i.used?'↩️ 标为待用':'✅ 标为已用'}</span><span data-a="edit">✏️ 编辑</span><span data-a="copy">📋 复制</span><span class="del" data-a="del">删除</span></div>`;
    d.querySelector('[data-a=use]').onclick=async ()=>{ i.used=!i.used; await dbPut('ideas',i); await load(); render(); };
    d.querySelector('[data-a=edit]').onclick=()=>{ editIdeaId=i.id; $('#ideaSheetTitle').textContent='编辑选题'; $('#iBody').value=i.body; $('#iTags').value=i.tags.join(' '); openSheet('#sheetIdea'); };
    d.querySelector('[data-a=copy]').onclick=async ()=>{ try{ await navigator.clipboard.writeText(i.body); toast('已复制'); }catch(e){ toast('复制失败'); } };
    d.querySelector('[data-a=del]').onclick=async ()=>{ if(!confirm('删除这条选题？'))return; await dbDel('ideas',i.id); await load(); render(); };
    box.appendChild(d);
  });
}

/* ================= 热点视频 ================= */
let editHotId=null;
const PLAT_COLOR={'抖音':'#161823','快手':'#ff5000','视频号':'#07c160','小红书':'#ff2442','B站':'#fb7299','其他':'#8a90a0'};
const HOT_ST={ref:'📌 参考',todo:'🎬 想拍同款',done:'✅ 已拍'};
$('#hSave').onclick=async ()=>{
  const title=$('#hTitle').value.trim();
  if(!title) return toast('写个标题好找回来');
  const old=editHotId?hots.find(x=>x.id===editHotId):null;
  await dbPut('hots',{id:editHotId||uid(),title,url:$('#hUrl').value.trim(),plat:$('#hPlat').value,status:$('#hStatus').value,note:$('#hNote').value.trim(),created:old?old.created:Date.now()});
  closeSheets(); await load(); render(); toast('已收藏');
};
$('#hotChips').querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
  hotFilter=c.dataset.p;
  $('#hotChips').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  render();
});
function renderHot(){
  const list=hots.filter(h=>{
    if(hotFilter!=='all'&&h.plat!==hotFilter)return false;
    if(keyword&&!((h.title+' '+h.note+' '+h.plat).toLowerCase().includes(keyword)))return false;
    return true;
  }).sort((a,b)=>b.created-a.created);
  const box=$('#hotList'); box.innerHTML='';
  $('#hotEmpty').classList.toggle('hidden',hots.length>0);
  list.forEach(h=>{
    const d=document.createElement('div'); d.className='card';
    d.innerHTML=`<div class="copy-title"><span>${esc(h.title)}</span><span class="hot-plat" style="background:${PLAT_COLOR[h.plat]||'#999'}">${esc(h.plat)}</span></div>
      <div style="font-size:12px;color:var(--brand2)">${HOT_ST[h.status]||''}</div>
      ${h.note?`<div class="copy-body" style="margin-top:4px">${esc(h.note)}</div>`:''}
      ${h.url?`<div class="hot-link">🔗 ${esc(h.url)}</div>`:''}
      <div class="row-actions">${h.url?'<span data-a="open">▶️ 打开</span><span data-a="copy">📋 复制链接</span>':''}<span data-a="edit">✏️ 编辑</span><span class="del" data-a="del">删除</span></div>`;
    const open=d.querySelector('[data-a=open]'); if(open) open.onclick=()=>window.open(h.url,'_blank');
    const cp=d.querySelector('[data-a=copy]'); if(cp) cp.onclick=async ()=>{ try{ await navigator.clipboard.writeText(h.url); toast('链接已复制'); }catch(e){ toast('复制失败'); } };
    d.querySelector('[data-a=edit]').onclick=()=>{ editHotId=h.id; $('#hotSheetTitle').textContent='编辑收藏'; $('#hTitle').value=h.title; $('#hUrl').value=h.url; $('#hPlat').value=h.plat; $('#hStatus').value=h.status; $('#hNote').value=h.note; openSheet('#sheetHot'); };
    d.querySelector('[data-a=del]').onclick=async ()=>{ if(!confirm('删除这条收藏？'))return; await dbDel('hots',h.id); await load(); render(); };
    box.appendChild(d);
  });
  if(hots.length&&!list.length) box.innerHTML='<div class="empty">没有匹配的收藏</div>';
}

/* ================= 考勤统计（多主播工时表） ================= */
let attMonth=todayStr().slice(0,7); // YYYY-MM

/* ================= 考勤模块 v6（极简录入 + 智能解析 + 看板汇总） =================
- 录入只剩「日期 + 备注」两字段；备注里手写「主播 类型 数字」，自动识别成多条结构化记录。
- 出勤 = 当月总天数 - 休假日数（按主播聚合），无需手录。
- 看板只看「主播×维度」汇总，不显示明细。
*/
const ATT_TYPE_PATTERNS = [
  [/场次|出勤/, '出勤'],  // v33: 1 条记录 = 1 场，无数字默认 1
  [/加班/, '加班'],
  [/请假|休假|歇/, '请假'],
  [/绩效/, '绩效'],
];
const ATT_NUM_RE = /(\d+(?:\.\d+)?)/;
const ATT_DATE_PRE = /^(\d{1,2})\s*[号日]\s*/;
const ATT_UNIT_RE = /个小时|小时|个钟头|h|H/gi;
function cleanHostName(name){
  if(!name) return '未分配';
  name = name.replace(ATT_UNIT_RE,'').replace(/^[\s,，\。\.、]+|[\s,，\。\.、]+$/g,'').trim();
  return name || '未分配';
}
function daysInMonth(ym){
  const [y,m]=ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function parseAttNote(text){
  if(!text) return [];
  return text.split(/[,，;；\n]+/).map(s=>s.trim()).filter(Boolean).map(parseOneAtt).filter(Boolean);
}
function parseOneAtt(seg){
  if(!seg) return null;
  seg = seg.replace(ATT_DATE_PRE,'').trim();
  if(!seg) return null;
  let type=null, typeKW='';
  for(const [re, t] of ATT_TYPE_PATTERNS){
    const m=seg.match(re);
    if(m){ type=t; typeKW=m[0]; break; }
  }
  if(!type) return null;
  let hours=0, hasNum=false;
  const num=seg.match(ATT_NUM_RE);
  if(num){ hours=parseFloat(num[1]); hasNum=true; }
  let name=cleanHostName(seg.replace(typeKW,'').replace(ATT_NUM_RE,''));
  name=name.replace(/^[\s,，\。\.]+|[\s,，\。\.]+$/g,'');
  if(!name) return null;
  let unit='';
  if(type==='请假') unit = seg.match(ATT_UNIT_RE) ? 'h' : '天';
  else if(type==='加班') unit='h';
  if(!hasNum && type==='请假') hours=1;
  if(!hasNum && type==='出勤') hours=1;  // v33: "张三" 自动 1 场
  return {hostName:name, type, hours, hasNum, unit};
}
function refreshAttPreview(){
  const text=$('#attNote').value.trim();
  const box=$('#attParsePreview');
  if(!text){
    box.innerHTML='<span style="color:#999">输入备注后实时识别主播·类型·数量…</span>';
    return;
  }
  const valid=parseAttNote(text).filter(s=>s.hasNum||s.type==='请假'||s.type==='出勤');  // v33: 出勤无数字也保留
  if(!valid.length){
    box.innerHTML='<span style="color:var(--danger)">⚠ 没识别到内容（每段要含主播+类型，如 婷婷加班5h / 梦淇5场 / 梦淇绩效7 / 梦淇）</span>';
    return;
  }
  const unit=s=>s.type==='加班'?'h':(s.type==='请假'?(s.unit==='h'?'h':'天'):'');
  box.innerHTML='<b>将保存 '+valid.length+' 条：</b><br>'+valid.map(s=>{
    const q=s.hasNum?s.hours:((s.type==='请假'||s.type==='出勤')?1:'');  // v33: 出勤无数字也按 1
    return `· <b>${esc(s.hostName)}</b> ${s.type} ${q}${unit(s)}`;
  }).join('<br>');
}
$('#attNote').oninput=refreshAttPreview;
$('#attSave').onclick=async ()=>{
  const date=$('#attDate').value||todayStr();
  const text=$('#attNote').value.trim();
  if(!text) return toast('写点备注');
  const segs=parseAttNote(text).filter(s=>s.hasNum||s.type==='请假'||s.type==='出勤');  // v33
  if(!segs.length) return toast('没识别到有效内容');
  let saved=0;
  for(const s of segs){
    let h=hosts.find(x=>x.name===s.hostName);
    if(!h){
      h={id:uid(),name:s.hostName,created:Date.now()};
      await dbPut('hosts',h);
      hosts.push(h);
    }
    await dbPut('attend',{id:uid(),date,hostId:h.id,hostName:s.hostName,type:s.type,hours:s.hours,unit:s.unit,note:text.slice(0,80),created:Date.now()});
    saved++;
  }
  closeSheets(); await load(); render();
  toast('已保存 '+saved+' 条');
};
$('#monPrev').onclick=()=>{ const [y,m]=attMonth.split('-').map(Number); attMonth=m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0'); render(); };
$('#monNext').onclick=()=>{ const [y,m]=attMonth.split('-').map(Number); attMonth=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0'); render(); };
$('#attBoard').querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k;
  if(attSort.key===k) attSort.dir*=-1; else attSort={key:k,dir:1};
  renderBoard();
});

function renderAttend(){
  // v7: 看板 + 录入明细 两段都在
  $('#hostChips').style.display='none';
  document.querySelectorAll('#view-attend .stat-row').forEach(e=>e.style.display='none');
  $('#attBoard').classList.remove('hidden');
  renderBoard();
  renderAttendLog();
}
/* ================= v36 主播个人看板：全屏大图（适合截图分享）+ 去累计冗余 ================= */
let currentHostCard=null;  // 当前展开的主播名（null=收起）
function toggleHostCard(name){
  const wrap=$('#hostCardWrap');
  // 同一个名字再点 → 收起
  if(currentHostCard===name){
    closeHostCard();
    return;
  }
  // 收集该主播所有记录（跨月）
  const recs=attend.filter(a=>cleanHostName(a.hostName)===name);
  const byMonth={};
  recs.forEach(a=>{
    const m=(a.date||'').slice(0,7);
    if(!m) return;
    byMonth[m]=byMonth[m]||{work:0,ot:0,leaveDays:0,leaveH:0,perf:0};
    const r=byMonth[m];
    if(a.type==='出勤') r.work+=(a.hours||1);
    else if(a.type==='加班') r.ot+=(a.hours||0);
    else if(a.type==='请假'){ if((a.unit||'天')==='h') r.leaveH+=(a.hours||0); else r.leaveDays+=(a.hours||0); }
    else if(a.type==='绩效') r.perf+=(a.hours||0);
  });
  const fmt=n=>Number(n).toFixed(n%1?1:0).replace(/\.0$/,'');
  const months=Object.keys(byMonth).sort().reverse();  // 新→旧
  const monthHtml=months.length? months.map(m=>{
    const d=byMonth[m];
    return `<div class="host-month">
      <div class="host-month-title">${m.replace('-','年')}月</div>
      <div class="host-month-grid">
        <div><div class="hm-lab">场次</div><b>${fmt(d.work)}</b></div>
        <div><div class="hm-lab">加班</div><b>${fmt(d.ot)}h</b></div>
        <div><div class="hm-lab">休假</div><b>${fmt(d.leaveDays)}天</b></div>
        <div><div class="hm-lab">请假</div><b>${fmt(d.leaveH)}h</b></div>
        <div><div class="hm-lab">绩效</div><b>${fmt(d.perf)}</b></div>
      </div>
    </div>`;
  }).join('') : '<div class="host-empty">还没有任何记录</div>';

  wrap.innerHTML=`
    <div class="host-mask"></div>
    <div class="host-full">
      <div class="host-head">
        <span class="host-avatar">${esc(name).slice(0,1)}</span>
        <div class="host-head-text">
          <div class="host-head-name">${esc(name)}</div>
          <div class="host-head-sub">📊 个人统计看板</div>
        </div>
        <span class="host-close">×</span>
      </div>
      <div class="host-months">${monthHtml}</div>
      <div class="host-tip">↑ 截图发给主播核对 · 点空白处或 × 关闭</div>
    </div>
  `;
  wrap.classList.remove('hidden');
  currentHostCard=name;
  // 高亮当前选中的名字
  document.querySelectorAll('#boardBody td.name').forEach(td=>{
    td.classList.toggle('host-active', td.dataset.host===name);
  });
  // 关闭交互
  wrap.querySelector('.host-close').onclick=closeHostCard;
  wrap.querySelector('.host-mask').onclick=closeHostCard;
  // 自动滚到顶部（让看板成为视觉中心）
  window.scrollTo({top:0, behavior:'smooth'});
}
function closeHostCard(){
  const wrap=$('#hostCardWrap');
  wrap.classList.add('hidden');
  wrap.innerHTML='';
  currentHostCard=null;
  document.querySelectorAll('#boardBody td.name').forEach(td=>td.classList.remove('host-active'));
}
function renderBoard(){
  $('#monLabel').textContent=attMonth.replace('-','年')+'月';
  const list=attend.filter(a=>a.date&&a.date.startsWith(attMonth));
  const map={};
  list.forEach(a=>{
    const name=(a.hostName&&a.hostName!=='未分配')?cleanHostName(a.hostName):'未分配';
    if(!map[name]) map[name]={name,work:0,ot:0,leaveDays:0,leaveH:0,perf:0};
    const r=map[name];
    if(a.type==='出勤') r.work+=(a.hours||1);  // v33: 场次 = 出场次数（hours 累加，无数字默认 1 场）
    else if(a.type==='加班') r.ot+=(a.hours||0);
    else if(a.type==='请假'){ if((a.unit||'天')==='h') r.leaveH+=(a.hours||0); else r.leaveDays+=(a.hours||0); }
    else if(a.type==='绩效') r.perf+=(a.hours||0);
  });
  let rows=Object.values(map).map(r=>({
    name:r.name,
    work:r.work,
    ot:Math.round(r.ot*10)/10,
    leave:Math.round(r.leaveDays*10)/10,
    leaveH:Math.round(r.leaveH*10)/10,
    perf:Math.round(r.perf*10)/10
  }));
  const {key,dir}=attSort;
  rows.sort((a,b)=> key==='name'? dir*a.name.localeCompare(b.name,'zh') : dir*((a[key]||0)-(b[key]||0)));
  const body=$('#boardBody'); body.innerHTML='';
  $('#boardEmpty').classList.toggle('hidden',rows.length>0);
  document.querySelectorAll('#attBoard th[data-k]').forEach(th=>{
    const sp=th.querySelector('.ar');
    sp.textContent= th.dataset.k===key ? (dir>0?'▲':'▼') : '';
  });
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="name clickable" data-host="${esc(r.name)}">${esc(r.name)}</td><td>${r.work}</td><td>${r.ot}</td><td>${r.leave}</td><td>${r.leaveH}</td><td>${r.perf}</td>`;
    body.appendChild(tr);
  });
  // v33: 点主播名 → 个人统计 sheet
  body.querySelectorAll('td.name.clickable').forEach(td=>{
    td.onclick=e=>{ e.stopPropagation(); toggleHostCard(td.dataset.host); };
  });
}
function renderAttendLog(){
  const box=$('#attendLog');
  if(!box) return;
  const list=attend.filter(a=>a.date&&a.date.startsWith(attMonth));
  if(!list.length){
    box.innerHTML='<div style="text-align:center;color:var(--sub);padding:18px 0;font-size:13px">这个月还没录过任何记录</div>';
    return;
  }
  const groups={};
  list.forEach(a=>{(groups[a.date]=groups[a.date]||[]).push(a);});
  const today=todayStr();
  const w=['日','一','二','三','四','五','六'];
  const typeKey={'出勤':'work','加班':'ot','请假':'leave','绩效':'perf'};
  const typeColor={'work':'var(--ok)','ot':'#f5804e','leave':'var(--danger)','perf':'var(--brand2)'};
  const dates=Object.keys(groups).sort().reverse();
  box.innerHTML=dates.map(date=>{
    const recs=groups[date].sort((a,b)=>(a.created||0)-(b.created||0));
    const dd=new Date(date+'T00:00:00');
    const isToday=date===today;
    const items=recs.map(r=>{
      const tk=typeKey[r.type];
      const u= r.type==='加班'?'h' : (r.type==='请假'?((r.unit||'天')==='h'?'h':'天') : (r.type==='绩效'?'':''));
      return `<div class="item">
        <span class="tag ${tk}" style="background:${typeColor[tk]||'#999'}">${r.type}</span>
        <span class="who">${esc(cleanHostName(r.hostName))}</span>
        <span class="val">${r.hours}${u}</span>
        <span class="del" data-del="${r.id}">删</span>
      </div>`;
    }).join('');
    return `<div class="day-card">
      <div class="day-head">
        <span class="day-date ${isToday?'today':''}">${date.slice(5).replace('-','/')} 周${w[dd.getDay()]}${isToday?' · 今天':''}</span>
        <span class="day-summary">${recs.length} 条</span>
        <span class="del-day" data-del-day="${date}">清空当天</span>
      </div>
      <div class="day-body">${items}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-del]').forEach(el=>el.onclick=async e=>{
    e.stopPropagation();
    const id=el.dataset.del;
    const r=attend.find(x=>x.id===id);
    if(!r) return;
    const u= r.type==='加班'?'h' : (r.type==='请假'?((r.unit||'天')==='h'?'h':'天') : '');
    if(!confirm('删除「'+cleanHostName(r.hostName)+' '+r.type+' '+r.hours+u+'」这条记录？'))return;
    await dbDel('attend',id); await load(); render(); toast('已删除');
  });
  box.querySelectorAll('[data-del-day]').forEach(el=>el.onclick=async e=>{
    e.stopPropagation();
    const d=el.dataset.delDay;
    const n=(groups[d]||[]).length;
    if(!n) return;
    if(!confirm('删除「'+d+'」这一天的全部 '+n+' 条记录？\\n（删除后看板统计会同步刷新）'))return;
    for(const r of groups[d]) await dbDel('attend',r.id);
    await load(); render(); toast('已清空 '+d+' 的记录');
  });
}


/* ================= 备份 / 恢复 ================= */
const blobToB64 = blob=>new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(blob); });
const b64ToBlob = async b64=>{ const r=await fetch(b64); return r.blob(); };

async function exportBackup(full){
  const bp=$('#backupProgress'); bp.classList.remove('hidden');
  const bar=$('#bpBar'), txt=$('#bpText');
  try{
    const data={ver:2,exportedAt:new Date().toISOString(),full,copies,tasks,ideas,hots,attend,assets:[]};
    if(full){
      let i=0;
      for(const a of assets){
        txt.textContent=`正在打包素材 ${++i}/${assets.length}（${esc(a.name)}）`;
        bar.value=i/assets.length*90;
        await new Promise(r=>setTimeout(r,0));
        let blob, thumb;
        if(a.kind==='cloud'){ blob=null; thumb=a.thumb; }
        else if(a.kind==='link'){ blob=a.blob; thumb=a.thumb; }
        else { blob=await blobToB64(a.blob); thumb=a.thumb?await blobToB64(a.thumb):null; }
        data.assets.push({...a,blob,thumb});
      }
    }else{
      data.assets=assets.map(a=>{
        if(a.kind==='link') return {id:a.id,name:a.name,type:a.type,kind:'link',url:a.url,thumb:a.thumb||null,cat:a.cat,tags:a.tags,created:a.created,size:0,metaOnly:true};
        if(a.kind==='cloud') return {id:a.id,name:a.name,type:a.type,kind:'cloud',url:a.url,thumb:a.thumb||null,cat:a.cat,tags:a.tags,created:a.created,size:a.size,metaOnly:true};
        return {id:a.id,name:a.name,type:a.type,mime:a.mime,size:a.size,cat:a.cat,tags:a.tags,created:a.created,blob:null,thumb:null,metaOnly:true};
      });
    }
    txt.textContent='正在生成备份文件…'; bar.value=95;
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    const aEl=document.createElement('a');
    aEl.href=URL.createObjectURL(blob);
    aEl.download='喵霸天备份_'+(full?'完整':'轻量')+'_'+todayStr()+'.json';
    aEl.click();
    setTimeout(()=>URL.revokeObjectURL(aEl.href),10000);
    toast('备份文件已生成（'+fmtSize(blob.size)+'），请妥善保存');
  }catch(e){ toast('备份失败：'+e.message); }
  bp.classList.add('hidden');
}
window.exportBackup=exportBackup; window.askNotify=askNotify; window.closePreview=closePreview;

$('#importFile').onchange=async e=>{
  const f=e.target.files[0]; if(!f)return;
  if(!confirm('恢复备份会与现有数据合并（相同条目以备份为准），继续吗？'))return;
  const bp=$('#backupProgress'); bp.classList.remove('hidden');
  const bar=$('#bpBar'), txt=$('#bpText');
  try{
    txt.textContent='正在读取备份文件…'; bar.value=10;
    const data=JSON.parse(await f.text());
    for(const c of data.copies||[]) await dbPut('copies',c);
    for(const t of data.tasks||[]) await dbPut('tasks',t);
    for(const i of data.ideas||[]) await dbPut('ideas',i);
    for(const h of data.hots||[]) await dbPut('hots',h);
    for(const a of data.attend||[]) await dbPut('attend',a);
    const as=data.assets||[];
    let i=0;
    for(const a of as){
      txt.textContent=`正在恢复素材 ${++i}/${as.length}`;
      bar.value=10+i/Math.max(as.length,1)*85;
      await new Promise(r=>setTimeout(r,0));
      if(a.kind==='link'||a.kind==='cloud'){ await dbPut('assets',a); continue; }
      if(a.metaOnly||!a.blob) continue; // 轻量备份不含文件本体
      a.blob=await b64ToBlob(a.blob);
      a.thumb=a.thumb?await b64ToBlob(a.thumb):null;
      delete a.metaOnly;
      await dbPut('assets',a);
    }
    await load(); render(); toast('恢复完成 ✓');
  }catch(err){ toast('恢复失败：文件格式不对'); }
  bp.classList.add('hidden'); e.target.value='';
};

/* ================= 统计 & 渲染入口 ================= */
async function load(){
  [assets,copies,tasks,ideas,hots,attend,hosts]=await Promise.all([dbAll('assets'),dbAll('copies'),dbAll('tasks'),dbAll('ideas'),dbAll('hots'),dbAll('attend'),dbAll('hosts')]);
  // 旧版"打卡"数据迁移为工时表记录（无主播字段的归到"未分配"）
  for(const a of attend){
    if(a.in!==undefined||a.out!==undefined){
      const h=hoursBetween(a.in,a.out);
      await dbPut('attend',{id:uid(),date:a.date||a.id,hostId:'',hostName:'未分配',type:'出勤',hours:h!=null?h:0,note:a.note||'',created:a.created||Date.now()});
      await dbDel('attend',a.id);
    }
  }
  if(attend.some(a=>a.in!==undefined||a.out!==undefined)) attend=await dbAll('attend');
}
async function renderStats(){
  $('#stAsset').textContent=assets.length;
  $('#stCopy').textContent=copies.length;
  $('#stTask').textContent=tasks.filter(t=>!isDoneToday(t)).length;
  try{ const est=await navigator.storage.estimate(); $('#stSize').textContent=fmtSize(est.usage); }catch(e){ $('#stSize').textContent='-'; }
  if('Notification' in window&&Notification.permission==='granted') $('#notifyState').textContent='已开启 ✓ 应用打开时到点会提醒';
}
function render(){
  if(curView==='assets') renderAssets();
  else if(curView==='copy') renderCopies();
  else if(curView==='plan') renderPlans();
  else if(curView==='ideas') renderIdeas();
  else if(curView==='hot') renderHot();
  else if(curView==='attend') renderAttend();
  else renderStats();
}

/* ================= 云存储 UI 绑定（提前执行，不依赖数据库加载） ================= */
// v19: 从云端仓库拉取所有图片到本机，实现「图片云端共享、清单各自同步」
async function syncFromCloud(silent){
  const token=$('#ghToken').value.trim()||(await kvGet('gh_token'));
  if(!token){ if(!silent) toast('先填 GitHub Token 才能拉取'); return; }
  const btn=$('#ghSync');
  if(!silent && btn){ btn.disabled=true; btn.textContent='拉取中…'; }
  $('#ghStatus').textContent='从云端拉取中…';
  try{
    const api=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.dir}`;
    const res=await fetch(api,{headers:{'Authorization':`Bearer ${token}`}});
    if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.message||('HTTP '+res.status)); }
    const list=await res.json();
    if(!Array.isArray(list)) throw new Error('云端目录为空或尚不存在');
    const extOk=n=>/\.(jpg|jpeg|png|gif|webp|avif|bmp|heic)$/i.test(n);
    const cloudUrls=new Set(list.filter(f=>extOk(f.name)).map(f=>f.download_url));
    const exist=new Set(assets.filter(a=>a.kind==='cloud').map(a=>a.url));
    let added=0, skipped=0, removed=0;
    for(const f of list){
      if(!extOk(f.name)) continue;            // 只拉图片
      const u=f.download_url;
      if(exist.has(u)){ skipped++; continue; } // 跳过本机已有的
      await dbPut('assets',{id:uid(),name:f.name,type:'image',mime:'image/'+((f.name.split('.').pop()||'jpeg').toLowerCase()),size:f.size||0,cat:'',tags:[],kind:'cloud',url:u,thumb:u,created:Date.now(),remote:true});
      added++;
    }
    // 双向同步：清理本机已不在云端的 cloud 记录（别人从云端删了，本机也清）
    for(const a of assets.filter(a=>a.kind==='cloud')){
      if(!cloudUrls.has(a.url)){ await dbDel('assets',a.id); removed++; }
    }
    await load(); render();
    $('#ghStatus').textContent=`✅ 拉取 ${added} 张新图、清理 ${removed} 张已删图（云端共 ${list.length} 个文件，已存在 ${skipped} 张）`;
    if(!silent) toast(added||removed?`已拉取 ${added} 张、清理 ${removed} 张`:'云端素材已全部在本机');
  }catch(e){
    $('#ghStatus').textContent='❌ 拉取失败：'+e.message;
    if(!silent) toast('拉取失败：'+e.message);
    console.error('[syncFromCloud failed]',e);
  }finally{
    if(!silent && btn){ btn.disabled=false; btn.textContent='从云端拉取素材'; }
  }
}

// 删除 GitHub 仓库里的云端源文件（先 GET 拿 sha，再 DELETE）
async function deleteFromCloud(item){
  const token=$('#ghToken').value.trim()||(await kvGet('gh_token'));
  if(!token) throw new Error('未配置 Token，无法删除云端文件');
  const path=`${GH.dir}/${item.name}`;   // 与上传路径保持一致（不编码）
  const api=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`;
  const r1=await fetch(api,{headers:{'Authorization':`Bearer ${token}`}});
  if(r1.status===404) return;            // 云端已无此文件，视为已删
  if(!r1.ok){ const e=await r1.json().catch(()=>({})); throw new Error(e.message||('HTTP '+r1.status)); }
  const meta=await r1.json();
  const r2=await fetch(api,{method:'DELETE',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:'delete asset '+item.name,sha:meta.sha,branch:GH.branch})});
  if(!r2.ok){ const e=await r2.json().catch(()=>({})); throw new Error(e.message||('HTTP '+r2.status)); }
}

// 删除文案：本机删除 + 记录到 pendingDel（下次云同步时传播删除意图）
async function delCopy(id){
  await dbDel('copies',id);
  pendingDel.add(id);
  try{ await kvPut('copy_del',[...pendingDel]); }catch(e){}
}

// 文案云端同步：云端存 cloud-data/copies.json = {copies:[...], deleted:[id...]}
// 双向合并：本机新增/编辑上传、云端新增拉回本机、删除意图跨设备传播
async function syncCopies(silent){
  const token=$('#ghToken').value.trim()||(await kvGet('gh_token'));
  if(!token){ if(!silent) toast('先填 GitHub Token 才能同步文案'); return; }
  const path='cloud-data/copies.json';
  const api=`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`;
  if(!silent) $('#ghStatus').textContent='文案云同步中…';
  try{
    let cloudCopies=[], cloudDel=[], sha=null;
    const r1=await fetch(api,{headers:{'Authorization':`Bearer ${token}`}});
    if(r1.ok){ const j=await r1.json(); sha=j.sha; const obj=JSON.parse(b64ToUtf8(j.content)); cloudCopies=Array.isArray(obj.copies)?obj.copies:[]; cloudDel=Array.isArray(obj.deleted)?obj.deleted:[]; }
    else if(r1.status!==404){ const e=await r1.json().catch(()=>({})); throw new Error(e.message||('HTTP '+r1.status)); }
    // 合并 copies：本机优先（同 id 取本机）
    const map=new Map();
    for(const c of cloudCopies) map.set(c.id,c);
    for(const c of copies) map.set(c.id,c);
    // 合并 deleted 列表（云端已有的 + 本机待删的）
    const delSet=new Set([...cloudDel, ...pendingDel]);
    for(const id of delSet) map.delete(id);
    const merged=[...map.values()];
    const mergedDel=[...delSet];
    // 写回本机：upsert 云端新增、清理本机被删的
    const localIds=new Set(copies.map(c=>c.id));
    let added=0, removed=0;
    for(const c of merged){ if(!localIds.has(c.id)){ await dbPut('copies',c); added++; } }
    for(const c of copies){ if(!map.has(c.id)){ await dbDel('copies',c.id); removed++; } }
    // PUT 云端（带 sha 乐观锁；冲突时简单重试一次）
    const body={message:'sync copies '+new Date().toISOString().slice(0,19),content:utf8ToB64(JSON.stringify({copies:merged,deleted:mergedDel},null,1)),branch:GH.branch};
    if(sha) body.sha=sha;
    let r2=await fetch(api,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r2.status===409 && sha){
      const r3=await fetch(api,{headers:{'Authorization':`Bearer ${token}`}}); const j3=await r3.json();
      body.sha=j3.sha; r2=await fetch(api,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    }
    if(!r2.ok){ const e=await r2.json().catch(()=>({})); throw new Error(e.message||('HTTP '+r2.status)); }
    pendingDel.clear(); try{ await kvPut('copy_del',[]); }catch(e){}
    await load(); render();
    if(!silent) toast(`文案同步完成：新增 ${added} 条、清理 ${removed} 条`);
  }catch(e){
    if(!silent) toast('文案同步失败：'+e.message);
    console.error('[syncCopies failed]',e);
  }finally{
    const b=$('#ghSyncCopy');
    if(b){ b.disabled=false; b.textContent='☁ 文案云同步'; }
  }
}

// 启动后静默自动同步云端素材（仅当已配置 token，不弹 toast、不碰按钮）
async function autoSync(){
  try{
    const t=await kvGet('gh_token');
    if(!t) return;                  // 没配云存储就不自动拉
    await syncFromCloud(true);      // silent 模式（图片）
    await syncCopies(true);         // silent 模式（文案）
  }catch(e){ console.warn('[autoSync]',e); }
}

function bindCloudUI(){
  const saveBtn=$('#ghSave'), testBtn=$('#ghTest'), syncBtn=$('#ghSync');
  if(!saveBtn||!testBtn) return;
  if(syncBtn) syncBtn.addEventListener('click', syncFromCloud);
  const copySyncBtn=$('#ghSyncCopy'); if(copySyncBtn) copySyncBtn.addEventListener('click', ()=>syncCopies(false));
  saveBtn.addEventListener('click', async ()=>{
    const t=$('#ghToken').value.trim(); if(!t)return toast('先粘贴 Token');
    await kvPut('gh_token',t); toast('Token 已保存 ✓');
  });
  testBtn.addEventListener('click', async ()=>{
    const t=$('#ghToken').value.trim()||(await kvGet('gh_token')); if(!t)return toast('先填 Token');
    $('#ghStatus').textContent='测试中…';
    try{
      const r=await fetch('https://api.github.com/user',{headers:{'Authorization':`Bearer ${t}`}});
      const d=await r.json();
      if(r.ok){ $('#ghStatus').textContent='✅ 已连接：'+d.login; }
      else $('#ghStatus').textContent='❌ '+d.message;
    }catch(e){ $('#ghStatus').textContent='❌ '+e.message; }
  });
}

/* ================= 启动 ================= */
(async function init(){
  bindCloudUI();   // 提前绑定云存储按钮，确保即使后续 DB 加载异常按钮也能用
  const d=new Date();
  $('#todayStr').textContent=`${d.getMonth()+1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`;
  await openDB(); await load(); render(); scheduleCheck();
  // 云存储：加载已存 token（按钮已在 bindCloudUI 提前绑定）
  try{
    const t=await kvGet('gh_token'); if(t && $('#ghToken')) $('#ghToken').value=t;
    const pd=await kvGet('copy_del'); if(Array.isArray(pd)) pendingDel=new Set(pd);
  }catch(e){}
  // 请求持久化存储，降低系统自动清理数据的概率
  try{ navigator.storage&&navigator.storage.persist&&navigator.storage.persist(); }catch(e){}
  if('serviceWorker' in navigator){ try{ navigator.serviceWorker.register('sw.js'); }catch(e){} }
  autoSync();   // 后台静默同步云端素材：任一端删/增，其他设备打开即自动对齐
})();

const STORE='neraidai-v03';
const state=JSON.parse(localStorage.getItem(STORE)||'{"records":[],"settings":{}}');
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const save=()=>localStorage.setItem(STORE,JSON.stringify(state));
const toast=m=>{const e=$('#toast');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=new Date().toISOString().slice(0,10); $('#date').value=today;
$('#todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{dateStyle:'long'}).format(new Date());

function scoreUnit(unitRecords){
  const sorted=[...unitRecords].sort((a,b)=>b.date.localeCompare(a.date));
  const recent=sorted.slice(0,7), avg=recent.reduce((s,r)=>s+Number(r.difference),0)/recent.length;
  const games=recent.reduce((s,r)=>s+Number(r.games),0)/recent.length;
  const last=recent[0]; const positive=recent.filter(r=>Number(r.difference)>0).length/recent.length;
  let score=Math.round(45+Math.min(22,Math.max(-22,-avg/180))+positive*18+Math.min(10,games/700));
  score=Math.max(5,Math.min(96,score));
  const reasons=[];
  if(avg<0) reasons.push(`直近${recent.length}件の平均差枚が${Math.round(avg).toLocaleString()}枚で反発候補`);
  else reasons.push(`直近${recent.length}件の勝率が${Math.round(positive*100)}%`);
  if(games>=4000) reasons.push(`平均${Math.round(games).toLocaleString()}Gでデータ信頼度が高め`);
  if(last) reasons.push(`最終記録 ${last.date} / ${Number(last.difference)>=0?'+':''}${Number(last.difference).toLocaleString()}枚`);
  return {unit:last.unit,position:last.position,score,reasons,count:recent.length};
}
function render(){
  const grouped=Object.groupBy?Object.groupBy(state.records,r=>r.position):state.records.reduce((o,r)=>((o[r.position]??=[]).push(r),o),{});
  const ranks=Object.values(grouped).map(scoreUnit).sort((a,b)=>b.score-a.score);
  $('#summary').innerHTML=`<div class="stat"><span>記録数</span><b>${state.records.length}</b></div><div class="stat"><span>登録台</span><b>${ranks.length}</b></div><div class="stat"><span>最高AI</span><b>${ranks[0]?.score??'--'}</b></div>`;
  $('#ranking').className=ranks.length?'ranking':'ranking empty-card';
  $('#ranking').innerHTML=ranks.length?ranks.map((r,i)=>`<article class="rank-card"><div class="rank-top"><span class="rank-num">${i+1}</span><div><span class="eyebrow">配置 ${esc(r.position)}</span><div class="unit">台番号 ${esc(r.unit)}</div></div><span class="badge">L真打吉宗</span></div><div class="score-row"><span class="score">${r.score}</span><span class="score-label">/ 100 AI SCORE</span></div><div class="meter"><i style="width:${r.score}%"></i></div><ul class="reasons">${r.reasons.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`).join(''):'データを入力すると、狙い台ランキングが表示されます。';
  const list=[...state.records].sort((a,b)=>b.date.localeCompare(a.date));
  $('#historyList').innerHTML=list.map(r=>`<article class="history-card"><div><b>${esc(r.date)} · 配置 ${esc(r.position)} / 台 ${esc(r.unit)}</b><p>${esc(r.machine)} · ${Number(r.games).toLocaleString()}G · BB ${r.bb} / RB ${r.rb}</p></div><b class="${r.difference>=0?'plus':'minus'}">${r.difference>=0?'+':''}${Number(r.difference).toLocaleString()}枚</b></article>`).join('')||'<div class="empty-card">まだ履歴がありません。</div>';
  const values=list.slice(0,18).reverse(); const max=Math.max(1,...values.map(r=>Math.abs(r.difference)));
  $('#chart').innerHTML='<span class="chart-label">差枚推移（新しい記録が右）</span>'+values.map(r=>`<i class="bar ${r.difference<0?'neg':''}" style="height:${20+Math.abs(r.difference)/max*115}px" title="${r.date}: ${r.difference}枚"></i>`).join('');
}
$$('.nav').forEach(b=>b.onclick=()=>{$$('.nav,.page').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.page).classList.add('active');render()});
$$('.mode').forEach(b=>b.onclick=()=>{$$('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#recordForm').classList.toggle('hidden',b.dataset.mode!=='manual');$('#screenshotPanel').classList.toggle('hidden',b.dataset.mode!=='screenshot')});
$('#recordForm').onsubmit=e=>{e.preventDefault();state.records.push({id:crypto.randomUUID(),date:$('#date').value,hall:$('#hall').value,machine:$('#machine').value,position:$('#position').value.trim(),unit:$('#unit').value.trim(),games:+$('#games').value,bb:+$('#bb').value,rb:+$('#rb').value,difference:+$('#difference').value,memo:$('#memo').value.trim(),createdAt:new Date().toISOString()});save();e.target.reset();$('#date').value=today;render();toast('保存しました')};
$('#refreshScore').onclick=()=>{render();toast('AIスコアを再計算しました')};
$('#pickScreenshot').onclick=()=>$('#screenshot').click();
let imageData=''; $('#screenshot').onchange=async e=>{const f=e.target.files[0];if(!f)return;imageData=await new Promise(ok=>{const r=new FileReader();r.onload=()=>ok(r.result);r.readAsDataURL(f)});$('#preview').src=imageData;$('#preview').hidden=false;$('#analyze').disabled=false};
$('#analyze').onclick=async()=>{const key=state.settings.openaiKey;if(!key)return toast('設定でOpenAI APIキーを登録してください');$('#analyze').disabled=true;$('#analyze').textContent='読み取り中…';try{const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'gpt-4.1-mini',input:[{role:'user',content:[{type:'input_text',text:'パチスロデータ画面から date(YYYY-MM-DD), unit, games, bb, rb, difference を抽出し、JSONオブジェクトのみ返してください。不明値は0。'},{type:'input_image',image_url:imageData}]}]})});if(!res.ok)throw new Error('API '+res.status);const json=await res.json();const text=json.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text||'';const data=JSON.parse(text.replace(/^```json|```$/g,'').trim());['date','unit','games','bb','rb','difference'].forEach(k=>{if($('#'+k)&&data[k]!=null)$('#'+k).value=data[k]});$$('.mode')[0].click();toast('読み取り結果をフォームへ反映しました')}catch(e){toast('読み取りに失敗しました: '+e.message)}finally{$('#analyze').disabled=false;$('#analyze').textContent='AIで読み取る'}};
$('#settingsForm').onsubmit=e=>{e.preventDefault();state.settings.openaiKey=$('#openaiKey').value.trim();state.settings.googleClientId=$('#googleClientId').value.trim();save();toast('設定を保存しました')};
$('#openaiKey').value=state.settings.openaiKey||'';$('#googleClientId').value=state.settings.googleClientId||'';
$('#demoBtn').onclick=()=>{const units=['1211','1212','1213','1214','1215'];for(let d=0;d<7;d++)units.forEach((u,i)=>state.records.push({id:crypto.randomUUID(),date:new Date(Date.now()-d*864e5).toISOString().slice(0,10),hall:'キクヤ堺本店',machine:'L真打吉宗',position:String(101+i),unit:u,games:2800+Math.floor(Math.random()*4500),bb:8+Math.floor(Math.random()*18),rb:3+Math.floor(Math.random()*10),difference:Math.floor(Math.random()*6000)-3000,memo:'サンプル'}));save();render();toast('サンプルデータを追加しました')};
$('#clearBtn').onclick=()=>{if(confirm('記録をすべて削除しますか？')){state.records=[];save();render();toast('削除しました')}};
$('#exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download=`neraidai-backup-${today}.json`;a.click();URL.revokeObjectURL(a.href)};
$('#syncBtn').onclick=()=>driveSync();
async function driveSync(){const clientId=state.settings.googleClientId;if(!clientId)return toast('設定でGoogle OAuthクライアントIDを登録してください');if(!window.google)return toast('Google認証の読み込み待ちです');const token=await new Promise((ok,ng)=>google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/drive.appdata',callback:r=>r.error?ng(r):ok(r.access_token)}).requestAccessToken());try{const headers={Authorization:`Bearer ${token}`};const list=await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'neraidai-v03.json'&fields=files(id,modifiedTime)",{headers}).then(r=>r.json());const localTime=Math.max(0,...state.records.map(r=>Date.parse(r.createdAt)||0));if(list.files?.length){const file=list.files[0];if(Date.parse(file.modifiedTime)>localTime){const remote=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,{headers}).then(r=>r.json());state.records=remote.records||[];save();render();toast('Driveから最新データを取得しました');return}await uploadDrive(file.id,token)}else await uploadDrive(null,token);$('#syncDot').classList.add('online');toast('Google Driveと同期しました')}catch(e){toast('同期に失敗しました')}}
async function uploadDrive(id,token){const meta={name:'neraidai-v03.json',parents:id?undefined:['appDataFolder']};const boundary='neraidai_boundary';const body=`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({records:state.records})}\r\n--${boundary}--`;await fetch(`https://www.googleapis.com/upload/drive/v3/files${id?'/'+id:''}?uploadType=multipart`,{method:id?'PATCH':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body})}
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');render();

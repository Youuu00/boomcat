const $ = s => document.querySelector(s);
const names = {
  bomb:'💣 炸弹', invisibleBomb:'🫥 隐身炸弹', delayBomb:'⏱️ 延时炸弹',
  defuse:'🛠️ 拆除', cut:'✂️ 切牌', help:'🤝 帮助', see:'🔮 查看',
  skip:'⏭️ 跳过', reverse:'🔄 转向', attack:'⚔️ 攻击', swap:'🔁 交换', nope:'🚫 禁止',
  adv_cut:'🌈 高级切牌', adv_see:'🌈 高级查看', adv_help:'🌈 高级帮助',
  adv_swap:'🌈 高级交换', adv_nope:'🌈 高级禁止'
};
const desc = {
  bomb:'没有拆除就会出局', invisibleBomb:'查看时伪装成非炸弹牌',
  delayBomb:'两次摸牌前会引爆，可转移', defuse:'拆除炸弹并放回牌堆',
  cut:'将牌堆底部指定张数切到顶部', help:'让对方给你一张牌',
  see:'查看牌堆顶三张', skip:'结束自己的回合', reverse:'结束回合并反转方向',
  attack:'目标连续两回合，只能被叠加一次', swap:'交换双方全部手牌',
  nope:'使当前目标牌失效', adv_cut:'秘密切牌，不公布张数',
  adv_see:'查看下一张炸弹的位置', adv_help:'不能被禁止的帮助',
  adv_swap:'只有对方禁止时才生效', adv_nope:'取消别人对你的禁止'
};
let token = localStorage.boomcatToken || '';
let state = null;
let events;
let shownPending = '';
let lastEffectId = '';
const pendingRequests = new Set();

function toast(message){
  const el=$('#toast'); el.textContent=message; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2200);
}
async function request(path,data,auth=true){
  const r=await fetch(path,{
    method:data===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json',...(auth&&token?{Authorization:`Bearer ${token}`}:{})},
    body:data===undefined?undefined:JSON.stringify(data)
  });
  const out=await r.json();
  if(!r.ok)throw Error(out.error||'操作失败');
  return out;
}
async function enter(result){
  token=result.token; localStorage.boomcatToken=token;
  $('#welcome').classList.add('hidden'); $('#game').classList.remove('hidden');
  connect();
}
function returnHome(){
  events?.close(); events=null; token=''; state=null; shownPending='';
  localStorage.removeItem('boomcatToken');
  forceCloseModal(); $('#game').classList.add('hidden'); $('#welcome').classList.remove('hidden');
}

$('#create').onclick=async()=>{
  try{ enter(await request('/api/create',{name:$('#name').value,mode:$('#gameMode')?.value||'advanced'},false)); }
  catch(e){ toast(e.message); }
};
$('#join').onclick=async()=>{
  try{ enter(await request('/api/join',{name:$('#name').value,code:$('#code').value},false)); }
  catch(e){ toast(e.message); }
};
function connect(){
  events?.close();
  events=new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.onmessage=e=>{state=JSON.parse(e.data);render();};
  events.onerror=()=>toast('连接中断，正在重连');
}
const post=async(path,data={})=>{
  if(pendingRequests.has(path))return;
  pendingRequests.add(path);
  if(state)renderActions();
  try{
    await request(path,data);
    state=await request('/api/state');
    render();
  }catch(e){
    if(path==='/api/bomb'&&e.message==='当前无需放置炸弹'){
      try{state=await request('/api/state');render();return;}catch{}
    }
    toast(e.message);
  }finally{
    pendingRequests.delete(path);
    if(state)renderActions();
  }
};

function openModal(title,body,actions=[],options={}){
  $('#modalTitle').textContent=title;
  $('#modalTitle').className=options.danger?'danger-title':'';
  $('#modalBody').innerHTML=body;
  const area=$('#modalActions'); area.innerHTML='';
  actions.forEach(action=>{
    const b=document.createElement('button');
    b.textContent=action.label; b.className=action.className||''; b.onclick=action.onClick;
    area.append(b);
  });
  $('#modalClose').style.display=options.locked?'none':'';
  $('#modal').classList.remove('hidden');
}
function closeModal(){ if($('#modalClose').style.display==='none')return; $('#modal').classList.add('hidden'); }
function forceCloseModal(){ $('#modalClose').style.display=''; $('#modal').classList.add('hidden'); }
$('#modalClose').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal();};
$('#chatBubbleButton').onclick=()=>$('#chatPanel').classList.toggle('collapsed');
$('#logToggle').onclick=()=>$('.log-shell').classList.toggle('expanded');
$('#rulesButton').onclick=()=>openModal('游戏规则',`<div class="rules">
  <p>2-6 人参与。创建房间时可以选择普通场或高级场。整局总牌数为 10 × 人数 + 2。每人获得 4 张功能牌和 1 张拆除，牌堆额外加入 2 张拆除。</p>
  <p>炸弹总数固定为人数 - 1。普通场只有普通炸弹；高级场可能把部分普通炸弹替换为隐身炸弹或延时炸弹，每类特殊炸弹最多 1 张。</p>
  <h3>回合流程</h3><p>出牌阶段可以使用任意数量的牌，也可以不出。随后必须摸一张牌并结束回合。</p>
  <p>受攻击玩家在连续回合中摸到炸弹并拆除，尚未进行的受攻击回合全部取消。</p>
  <h3>高级牌</h3><p>高级牌仅高级场出现。高级切牌不公开数量；高级查看能看下一张炸弹位置；高级帮助不能被禁止；高级交换只有被禁止才生效；高级禁止能取消别人对你的禁止。</p>
</div>`);
$('#leaveButton').onclick=()=>{
  const active=state?.status==='playing';
  openModal('退出房间',`<p>${active?'游戏正在进行，退出后将视为出局。':'确定要离开当前房间吗？'}</p>${state?.host&&state.players.length>1?'<p>房主将自动转交给下一位玩家。</p>':''}`,[
    {label:'确认退出',onClick:async()=>{try{await request('/api/leave',{});returnHome();}catch(e){toast(e.message);}}},
    {label:'留在房间',className:'secondary',onClick:forceCloseModal}
  ],{danger:active});
};

function render(){
  $('#roomCode').textContent=`🔑 房间码 ${state.code} · ${state.mode==='normal'?'普通场':'高级场'}`;
  $('#deck').textContent=`🃏 ${state.deckCount}`;
  $('#directionBadge').textContent=state.direction===1?'↻':'↺';
  renderPlayers();
  $('#log').innerHTML=state.log.map(x=>`<div>${esc(x)}</div>`).join('');
  renderChat();
  renderEffect();
  const notice=$('#notice'); notice.style.display='none';
  if(state.me.peek){notice.style.display='block'; notice.textContent=`查看结果：${state.me.peek.map(x=>names[x]||x).join(' → ')}`;}
  if(state.pending){
    const shownType=visiblePendingType(state.pending.type);
    notice.style.display='block';
    notice.textContent=state.pending.targetMe?`${state.pending.sourceName} 对你使用了【${names[shownType]}】，请选择处理方式`:`等待目标玩家处理【${names[shownType]}】`;
  }
  renderPendingModal();
  renderActions();
  renderHand();
}
function renderPlayers(){
  const total=state.players.length;
  const meIndex=Math.max(0,state.players.findIndex(p=>p.token===state.me.token));
  const nextToken=getNextToken();
  $('#players').innerHTML=state.players.map((p,index)=>{
    const seat=(index-meIndex+total)%total;
    const angle=-90+seat*360/Math.max(total,1);
    const rx=total<=2?34:43, ry=total<=2?30:38;
    const x=50+rx*Math.cos(angle*Math.PI/180), y=50+ry*Math.sin(angle*Math.PI/180);
    const fx=state.effect;
    const bubbleCard=fx&&fx.type==='card'&&fx.source===p.token&&Date.now()-fx.issuedAt<2600?visiblePendingType(fx.card):null;
    return `<article class="seat ${p.token===state.me.token?'me ':''}${p.token===state.turnToken?'current ':''}${p.token===nextToken?'next ':''}${p.alive?'':'dead'}" style="left:${x}%;top:${y}%">
      ${bubbleCard?`<div class="seat-bubble">${esc(names[bubbleCard]||bubbleCard)}</div>`:''}
      <div class="avatar">${p.alive?'😼':'💥'}</div>
      <b>${esc(p.name)} ${p.host?'👑':''}</b>
      <small>${p.alive?`${p.cards}张牌`:'已出局'} · ${p.ready?'✅':'⏳'}</small>
      ${p.token===nextToken?'<em class="next-arrow">➜</em>':''}
    </article>`;
  }).join('');
}
function getNextToken(){
  if(state.status!=='playing'||!state.turnToken)return null;
  const list=state.players; let index=list.findIndex(p=>p.token===state.turnToken);
  if(index<0)return null;
  for(let i=0;i<list.length;i++){ index=(index+state.direction+list.length)%list.length; if(list[index].alive)return list[index].token; }
  return null;
}
function visiblePendingType(type){
  return type==='adv_swap'?'swap':type;
}
function renderPendingModal(){
  if(!state.pending?.targetMe){shownPending='';return;}
  const key=`${state.pending.type}:${state.pending.sourceName}:${state.pending.attackDepth||0}`;
  if(shownPending===key)return;
  shownPending=key;
  const actions=[];
  if(state.pending.type==='adv_nope'){
    if(state.me.hand.includes('adv_nope'))actions.push({label:'🌈 使用【高级禁止】取消禁止',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'adv_nope'});}});
    actions.push({label:'不使用',className:'secondary',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'accept'});}});
    openModal('有人禁止了你的牌！',`<p><b>${esc(state.pending.sourceName)}</b> 使用了【禁止】，你可以用【高级禁止】反制，让原卡继续结算。</p>`,actions,{danger:true,locked:true});
    return;
  }
  if(!state.pending.noNope&&state.me.hand.includes('nope')){
    actions.push({label:'使用【禁止】使其失效',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'nope'});}});
  }
  if(state.pending.type==='help'||state.pending.type==='adv_help'){
    state.me.hand.forEach((card,index)=>actions.push({label:`交出【${names[card]||card}】`,className:'target-button',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'accept',cardIndex:index});}}));
    openModal(state.pending.type==='adv_help'?'你被高级帮助点名！':'你被要求帮助！',`<p><b>${esc(state.pending.sourceName)}</b> 要求你交出一张手牌。</p>${state.pending.type==='adv_help'?'<p><b>高级帮助不能被禁止</b>，请直接选择要交出的牌。</p>':'<p>你可以选择使用【禁止】，或交出一张牌。</p>'}`,actions,{danger:true,locked:true});
    return;
  }
  if(state.pending.type==='attack'&&!state.pending.stacked&&state.me.hand.includes('attack'))actions.push({label:'⚔️ 叠加攻击（只能叠加一次）',onClick:()=>chooseAttackTarget(true)});
  const shownType=visiblePendingType(state.pending.type);
  actions.push({label:`接受【${names[shownType]}】`,className:'secondary',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'accept'});}});
  openModal(`你被使用了【${names[shownType]}】！`,`<p><b>${esc(state.pending.sourceName)}</b> 对你使用了这张牌，请立即处理。</p>`,actions,{danger:true,locked:true});
}
function renderActions(){
  const a=$('#actions'); a.innerHTML='';
  if(state.status==='lobby'){
    $('#turn').textContent='⏳ 等待玩家准备';
    if(state.host){a.innerHTML='<button id="start">🚀 开始游戏</button>'; $('#start').onclick=()=>post('/api/start');}
    else{a.innerHTML=`<button id="ready">${state.players.find(p=>p.token===state.me.token).ready?'↩️ 取消准备':'✅ 准备'}</button>`; $('#ready').onclick=()=>post('/api/ready');}
    return;
  }
  if(state.status==='finished'){
    $('#turn').textContent=`🏆 ${state.winner} 获胜！`;
    if(state.host)addButton(a,'🔄 再来一局',()=>post('/api/rematch'));
    else{const wait=document.createElement('span'); wait.textContent='⏳ 等待房主发起下一局'; a.append(wait);}
    return;
  }
  $('#turn').textContent=state.turnToken===state.me.token?'👉 轮到你了！':`⏳ 等待 ${state.turnName} 行动`;
  if(state.pending?.targetMe){
    if(state.pending.type==='adv_nope'){ if(state.me.hand.includes('adv_nope'))addButton(a,'🌈 使用高级禁止',()=>post('/api/resolve',{action:'adv_nope'})); addButton(a,'不使用',()=>post('/api/resolve',{action:'accept'})); return; }
    if(!state.pending.noNope&&state.me.hand.includes('nope'))addButton(a,'使用禁止',()=>post('/api/resolve',{action:'nope'}));
    if(state.pending.type==='help'||state.pending.type==='adv_help'){
      const select=document.createElement('select'); state.me.hand.forEach((c,i)=>select.add(new Option(names[c]||c,i))); a.append(select);
      addButton(a,'交出此牌',()=>post('/api/resolve',{action:'accept',cardIndex:Number(select.value)}));
    }else addButton(a,'接受',()=>post('/api/resolve',{action:'accept'}));
    return;
  }
  if(state.me.pendingBomb){
    const max=state.deckCount+1;
    const label=document.createElement('span'); label.textContent=`放在第 1～${max} 张：`; a.append(label);
    const input=document.createElement('input'); input.type='number'; input.min=1; input.max=max; input.value=1; input.disabled=pendingRequests.has('/api/bomb'); a.append(input);
    const button=addButton(a,pendingRequests.has('/api/bomb')?'⏳ 正在放回…':'💣 放回炸弹',()=>post('/api/bomb',{position:Number(input.value)})); button.disabled=pendingRequests.has('/api/bomb');
    return;
  }
  if(state.turnToken===state.me.token&&!state.pending)addButton(a,'🃏 摸一张牌',()=>post('/api/draw'));
}
function renderHand(){
  const hand=$('#hand'); hand.innerHTML='';
  const groups=new Map();
  state.me.hand.forEach(type=>groups.set(type,(groups.get(type)||0)+1));
  const entries=[...groups.entries()];
  const compact=window.matchMedia('(max-width: 560px)').matches;
  const cardWidth=compact?78:96;
  const safeWidth=Math.max(220,(hand.clientWidth||window.innerWidth)-28);
  const overlap=entries.length>1?Math.min(cardWidth-46,Math.ceil(Math.max(0,entries.length*cardWidth-safeWidth)/(entries.length-1))):0;
  entries.forEach(([type,count],index,arr)=>{
    const b=document.createElement('button'); const offset=index-(arr.length-1)/2;
    b.className=`card ${type} ${type.startsWith('adv_')?'advanced':''}`;
    b.style.width=`${cardWidth}px`; b.style.flexBasis=`${cardWidth}px`; b.style.marginLeft=index?`${-overlap}px`:'0px';
    b.style.setProperty('--fan',`${offset*Math.min(5,Math.max(2.4,30/Math.max(arr.length,1)))}deg`);
    b.style.setProperty('--lift',`${Math.abs(offset)*-4}px`);
    b.innerHTML=`<strong>${names[type]||type}</strong><small>${desc[type]||''}</small>${count>1?`<span class="card-count">x${count}</span>`:''}`;
    b.onclick=()=>use(type);
    if(state.me.pendingBomb){b.disabled=true; b.title='请先放回炸弹';}
    hand.append(b);
  });
}
function use(type){
  if(state.me.pendingBomb)return toast('请先把炸弹放回牌堆');
  if(['bomb','invisibleBomb','delayBomb','defuse','nope','adv_nope'].includes(type))return toast('这张牌不能主动使用');
  if(state.turnToken!==state.me.token)return toast('还没轮到你');
  if(['help','attack','swap','adv_help','adv_swap'].includes(type)){
    const candidates=state.players.filter(p=>p.alive&&((type==='attack')||p.token!==state.me.token));
    const actions=candidates.map(p=>({label:p.token===state.me.token?`${p.name}（自己）`:p.name,className:'target-button',onClick:()=>{forceCloseModal();post('/api/play',{type,target:p.token});}}));
    openModal(`选择【${names[type]}】的目标`,`<p>${esc(desc[type])}</p>`,actions);
    return;
  }
  if(type==='cut'||type==='adv_cut'){
    const max=state.deckCount;
    openNumberModal('✂️ 切牌',`将牌堆底部多少张牌切到顶部？（1～${max}）`,1,max,value=>post('/api/play',{type,count:value}));
    return;
  }
  post('/api/play',{type});
}
function chooseAttackTarget(stacking=false){
  forceCloseModal();
  const actions=state.players.filter(p=>p.alive).map(p=>({label:p.token===state.me.token?`${p.name}（自己）`:p.name,className:'target-button',onClick:()=>{forceCloseModal();post(stacking?'/api/stack-attack':'/api/play',stacking?{target:p.token}:{type:'attack',target:p.token});}}));
  openModal(stacking?'⚔️ 选择叠加攻击目标':'选择攻击目标',`<p>${stacking?'这一张攻击会让最终目标再多进行一个回合。':'目标将连续进行两个回合。'}</p>`,actions,{danger:stacking});
}
function openNumberModal(title,text,min,max,onConfirm){
  openModal(title,`<p>${esc(text)}</p><input id="numberChoice" class="number-choice" type="number" min="${min}" max="${max}" value="${min}">`,[
    {label:'确认',onClick:()=>{const value=Number($('#numberChoice').value); if(!Number.isInteger(value)||value<min||value>max)return toast(`请输入 ${min}～${max}`); forceCloseModal(); onConfirm(value);}},
    {label:'取消',className:'secondary',onClick:forceCloseModal}
  ]);
}
function renderChat(){
  const box=$('#chatMessages');
  const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<45;
  const me=state.players.find(p=>p.token===state.me.token);
  box.innerHTML=(state.chat||[]).map(m=>`<div class="chat-line ${m.name===me?.name?'mine ':''}${m.alive?'':'spectator'}"><b>${m.alive?'😼':'👻'} ${esc(m.name)}</b><span>${esc(m.text)}</span></div>`).join('')||'<div class="chat-empty">还没有人说话</div>';
  if(nearBottom)box.scrollTop=box.scrollHeight;
}
function renderEffect(){
  const fx=state.effect;
  if(!fx||fx.id===lastEffectId||Date.now()-fx.issuedAt>8000)return;
  if(fx.type==='card'){
    $('#effectOverlay').classList.add('hidden');
    lastEffectId=fx.id;
    return;
  }
  lastEffectId=fx.id;
  const icons={bomb:'💥',invisibleBomb:'🫥',delayBomb:'⏱️',defuse:'🛠️',cut:'✂️',help:'🤝',see:'🔮',skip:'⏭️',reverse:'🔄',attack:'⚔️',swap:'🔁',nope:'🚫',adv_cut:'🌈',adv_see:'🌈',adv_help:'🌈',adv_swap:'🌈',adv_nope:'🌈'};
  const overlay=$('#effectOverlay');
  const involved=fx.role==='source'||fx.role==='target';
  overlay.className=`effect-overlay ${fx.type} card-${fx.card||'none'} role-${fx.role} ${involved?'involved':'observer'}`;
  $('#effectIcon').textContent=fx.type==='bomb-defuse'?'💣🛠️':fx.type==='bomb'?'💥':icons[fx.card]||'✨';
  const actors=$('#effectActors');
  actors.textContent=fx.targetName?`${fx.sourceName}  ${fx.card==='swap'||fx.card==='adv_swap'?'VS':'→'}  ${fx.targetName}`:(fx.sourceName||'');
  $('#effectTitle').textContent=involved?fx.title:(fx.targetName?`${fx.sourceName} ${fx.card==='swap'||fx.card==='adv_swap'?'VS':'→'} ${fx.targetName}`:`${fx.sourceName} 使用了 ${fx.title}`);
  $('#effectSubtitle').textContent=fx.subtitle||(fx.targetName?`使用【${names[fx.card]||fx.title}】`:'');
  clearTimeout(renderEffect.timer);
  renderEffect.timer=setTimeout(()=>overlay.classList.add('hidden'),fx.type==='bomb'?2200:1700);
}
$('#chatForm').onsubmit=e=>{e.preventDefault(); const input=$('#chatInput'); const message=input.value.trim(); if(!message)return; post('/api/chat',{message}); input.value='';};
function addButton(parent,label,fn){const b=document.createElement('button'); b.textContent=label; b.onclick=fn; parent.append(b); return b;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
if(token){
  request('/api/state').then(()=>{$('#welcome').classList.add('hidden');$('#game').classList.remove('hidden');connect();})
    .catch(()=>{token='';localStorage.removeItem('boomcatToken');});
}

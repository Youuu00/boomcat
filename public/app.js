const $ = s => document.querySelector(s);
const names = {bomb:'💣 炸弹',defuse:'🛠️ 拆除',cut:'✂️ 切牌',help:'🤝 帮助',see:'🔮 查看',skip:'⏭️ 跳过',reverse:'🔄 转向',attack:'⚔️ 攻击',swap:'🔁 交换',nope:'🚫 禁止'};
const desc = {bomb:'没有拆除就会出局',defuse:'拆除炸弹并放回牌堆',cut:'将牌堆底部指定张数切到顶部',help:'让对方给你一张牌',see:'查看牌堆顶三张',skip:'结束自己的回合',reverse:'结束回合并反转方向',attack:'目标连续两回合，可叠加增加回合',swap:'交换双方全部手牌',nope:'只使当前一张目标牌失效'};
let token = localStorage.boomcatToken || ''; let state = null; let events; let shownPending = ''; let lastEffectId = '';
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
async function request(path,data,auth=true){
  const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth&&token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const out=await r.json();if(!r.ok)throw Error(out.error||'操作失败');return out;
}
async function enter(result){token=result.token;localStorage.boomcatToken=token;$('#welcome').classList.add('hidden');$('#game').classList.remove('hidden');connect()}
function returnHome(){
  events?.close();events=null;token='';state=null;shownPending='';localStorage.removeItem('boomcatToken');
  forceCloseModal();$('#game').classList.add('hidden');$('#welcome').classList.remove('hidden');
}
$('#create').onclick=async()=>{try{enter(await request('/api/create',{name:$('#name').value},false))}catch(e){toast(e.message)}};
$('#join').onclick=async()=>{try{enter(await request('/api/join',{name:$('#name').value,code:$('#code').value},false))}catch(e){toast(e.message)}};
function connect(){
  events?.close();events=new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.onmessage=e=>{state=JSON.parse(e.data);render()};events.onerror=()=>toast('连接中断，正在重连');
}
const post=async(path,data={})=>{try{await request(path,data)}catch(e){toast(e.message)}};
function openModal(title,body,actions=[],options={}){
  $('#modalTitle').textContent=title;$('#modalTitle').className=options.danger?'danger-title':'';
  $('#modalBody').innerHTML=body;const area=$('#modalActions');area.innerHTML='';
  actions.forEach(action=>{const b=document.createElement('button');b.textContent=action.label;b.className=action.className||'';b.onclick=action.onClick;area.append(b)});
  $('#modalClose').style.display=options.locked?'none':'';$('#modal').classList.remove('hidden');
}
function closeModal(){if($('#modalClose').style.display==='none')return;$('#modal').classList.add('hidden')}
$('#modalClose').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};
$('#rulesButton').onclick=()=>openModal('游戏规则',`<div class="rules">
  <p>2–6 人参与。每人获得 4 张功能牌和 1 张拆除，牌堆加入“玩家数减一”张炸弹。</p>
  <h3>回合流程</h3><p>出牌阶段可以使用任意数量的牌，也可以不出。随后必须摸一张牌并结束回合。默认按逆时针行动。</p>
  <p>受攻击玩家在连续回合中的任意一回合摸到炸弹并拆除，尚未进行的受攻击回合全部取消，直接轮到下一位。</p>
  <h3>胜利条件</h3><p>摸到炸弹时，没有拆除牌便立即出局；最后存活的玩家获胜。</p>
  <h3>卡牌说明</h3><ol>
    <li><b>炸弹：</b>摸到且没有拆除便出局。</li><li><b>拆除：</b>拆掉炸弹，并把炸弹放回牌堆任意位置。</li>
    <li><b>切牌：</b>将牌堆底部指定张数切到顶部。</li><li><b>帮助：</b>指定玩家选择一张手牌交给你。</li>
    <li><b>查看：</b>查看牌堆顶三张牌。</li><li><b>跳过：</b>立即结束自己的回合。</li>
    <li><b>转向：</b>结束回合并反转行动方向。</li><li><b>攻击：</b>目标连续两个回合；目标可继续叠加攻击，每叠一张增加一个回合。</li>
    <li><b>交换：</b>与指定玩家交换全部手牌。</li><li><b>禁止：</b>只阻止当前一张帮助、攻击或交换；不能一次阻止整条攻击链。</li>
  </ol><h3>公共聊天</h3><p>房间内所有玩家都能发言，已经出局的玩家也可以继续聊天。</p></div>`);
$('#leaveButton').onclick=()=>{
  const active=state?.status==='playing';
  openModal('退出房间',`<p>${active?'游戏正在进行，退出后将视为出局。':'确定要离开当前房间吗？'}</p>${state?.host&&state.players.length>1?'<p>房主将自动转交给下一位玩家。</p>':''}`,[
    {label:'确认退出',onClick:async()=>{try{await request('/api/leave',{});returnHome()}catch(e){toast(e.message)}}},
    {label:'留在房间',className:'secondary',onClick:forceCloseModal}
  ],{danger:active});
};
function render(){
  $('#roomCode').textContent=`🔑 房间码 ${state.code}`;$('#deck').textContent=`🃏 ${state.deckCount}`;
  $('#players').innerHTML=state.players.map(p=>`<article class="${p.token===state.turnToken?'current ':''}${p.alive?'':'dead'}"><b>${p.alive?'😼':'💥'} ${esc(p.name)} ${p.host?'👑':''}</b><small>${p.alive?`${p.cards} 张牌`:'已出局'} · ${p.ready?'✅ 已准备':'⏳ 未准备'}</small></article>`).join('');
  $('#log').innerHTML=state.log.map(x=>`<div>${esc(x)}</div>`).join('');
  renderChat();renderEffect();
  const notice=$('#notice');notice.style.display='none';
  if(state.me.peek){notice.style.display='block';notice.textContent=`牌堆顶三张：${state.me.peek.map(x=>names[x]).join(' → ')}`}
  if(state.pending){notice.style.display='block';notice.textContent=state.pending.targetMe?`${state.pending.sourceName} 对你使用了【${names[state.pending.type]}】，请选择处理方式`:`等待目标玩家处理【${names[state.pending.type]}】`}
  renderPendingModal();
  renderActions();renderHand();
}
function renderPendingModal(){
  if(!state.pending?.targetMe){shownPending='';return}
  const key=`${state.pending.type}:${state.pending.sourceName}:${state.pending.attackDepth||0}`;if(shownPending===key)return;shownPending=key;
  const actions=[];
  if(state.me.hand.includes('nope'))actions.push({label:'使用【禁止】使其失效',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'nope'})}});
  if(state.pending.type==='help'){
    state.me.hand.forEach((card,index)=>actions.push({label:`交出【${names[card]}】`,className:'target-button',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'accept',cardIndex:index})}}));
    openModal('你被要求帮助！',`<p><b>${esc(state.pending.sourceName)}</b> 要求你交出一张手牌，请选择。</p>`,actions,{danger:true,locked:true});
  }else{
    if(state.pending.type==='attack'&&state.me.hand.includes('attack'))actions.push({label:`⚔️ 叠加攻击（目标将有 ${state.pending.attackDepth+2} 回合）`,onClick:()=>chooseAttackTarget(true)});
    actions.push({label:`接受【${names[state.pending.type]}】`,className:'secondary',onClick:()=>{forceCloseModal();post('/api/resolve',{action:'accept'})}});
    openModal(`你被使用了【${names[state.pending.type]}】！`,`<p><b>${esc(state.pending.sourceName)}</b> 对你使用了这张牌，请立即处理。</p>`,actions,{danger:true,locked:true});
  }
}
function forceCloseModal(){$('#modalClose').style.display='';$('#modal').classList.add('hidden')}
function renderActions(){
  const a=$('#actions');a.innerHTML='';
  if(state.status==='lobby'){
    $('#turn').textContent='⏳ 等待玩家准备';
    if(state.host){a.innerHTML=`<button id="start">🚀 开始游戏</button>`;$('#start').onclick=()=>post('/api/start')}
    else{a.innerHTML=`<button id="ready">${state.players.find(p=>p.token===state.me.token).ready?'↩️ 取消准备':'✅ 准备'}</button>`;$('#ready').onclick=()=>post('/api/ready')}
    return;
  }
  if(state.status==='finished'){
    $('#turn').textContent=`🏆 ${state.winner} 获胜！`;
    if(state.host)addButton(a,'🔄 再来一局',()=>post('/api/rematch'));
    else{const wait=document.createElement('span');wait.textContent='⏳ 等待房主发起下一局';a.append(wait)}
    return;
  }
  $('#turn').textContent=state.turnToken===state.me.token?'👉 轮到你了！':`⏳ 等待 ${state.turnName} 行动`;
  if(state.pending?.targetMe){
    if(state.me.hand.includes('nope'))addButton(a,'使用禁止',()=>post('/api/resolve',{action:'nope'}));
    if(state.pending.type==='help'){
      const select=document.createElement('select');state.me.hand.forEach((c,i)=>select.add(new Option(names[c],i)));a.append(select);addButton(a,'交出此牌',()=>post('/api/resolve',{action:'accept',cardIndex:Number(select.value)}));
    }else addButton(a,'接受',()=>post('/api/resolve',{action:'accept'}));return;
  }
  if(state.me.pendingBomb){
    const max=state.deckCount+1;const label=document.createElement('span');label.textContent=`放在第 1～${max} 张：`;a.append(label);
    const input=document.createElement('input');input.type='number';input.min=1;input.max=max;input.value=1;a.append(input);addButton(a,'💣 放回炸弹',()=>post('/api/bomb',{position:Number(input.value)}));return;
  }
  if(state.turnToken===state.me.token&&!state.pending)addButton(a,'🃏 摸一张牌',()=>post('/api/draw'));
}
function renderHand(){
  const hand=$('#hand');hand.innerHTML='';
  state.me.hand.forEach(type=>{const b=document.createElement('button');b.className=`card ${type}`;b.innerHTML=`<strong>${names[type]}</strong><small>${desc[type]}</small>`;b.onclick=()=>use(type);hand.append(b)});
}
function use(type){
  if(['bomb','defuse','nope'].includes(type))return toast('这张牌不能主动使用');
  if(state.turnToken!==state.me.token)return toast('还没轮到你');
  const targeted=['help','attack','swap'].includes(type);
  if(targeted){
    const candidates=state.players.filter(p=>p.alive&&(type==='attack'||p.token!==state.me.token));
    const actions=candidates.map(p=>({label:p.token===state.me.token?`${p.name}（自己）`:p.name,className:'target-button',onClick:()=>{forceCloseModal();post('/api/play',{type,target:p.token})}}));
    openModal(`选择【${names[type]}】的目标`,`<p>${esc(desc[type])}</p>`,actions);
    return;
  }
  if(type==='cut'){
    const max=state.deckCount;openNumberModal('✂️ 切牌',`将牌堆底部多少张牌切到顶部？（1～${max}）`,1,max,value=>post('/api/play',{type,count:value}));return;
  }
  post('/api/play',{type});
}
function chooseAttackTarget(stacking=false){
  forceCloseModal();
  const actions=state.players.filter(p=>p.alive).map(p=>({label:p.token===state.me.token?`${p.name}（自己）`:p.name,className:'target-button',onClick:()=>{forceCloseModal();post(stacking?'/api/stack-attack':'/api/play',stacking?{target:p.token}:{type:'attack',target:p.token})}}));
  openModal(stacking?'⚔️ 选择叠加攻击目标':'选择攻击目标',`<p>${stacking?'这一张攻击会让最终目标再多进行一个回合。':'目标将连续进行两个回合。'}</p>`,actions,{danger:stacking});
}
function openNumberModal(title,text,min,max,onConfirm){
  openModal(title,`<p>${esc(text)}</p><input id="numberChoice" class="number-choice" type="number" min="${min}" max="${max}" value="${min}">`,[
    {label:'确认',onClick:()=>{const value=Number($('#numberChoice').value);if(!Number.isInteger(value)||value<min||value>max)return toast(`请输入 ${min}～${max}`);forceCloseModal();onConfirm(value)}},
    {label:'取消',className:'secondary',onClick:forceCloseModal}
  ]);
}
function renderChat(){
  const box=$('#chatMessages');const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<45;
  box.innerHTML=(state.chat||[]).map(m=>`<div class="chat-line ${m.alive?'':'spectator'}"><b>${m.alive?'😼':'👻'} ${esc(m.name)}</b><span>${esc(m.text)}</span></div>`).join('')||'<div class="chat-empty">还没有人说话</div>';
  if(nearBottom)box.scrollTop=box.scrollHeight;
}
function renderEffect(){
  const fx=state.effect;if(!fx||fx.id===lastEffectId||Date.now()-fx.issuedAt>8000)return;lastEffectId=fx.id;
  const icons={bomb:'💥',defuse:'🛠️',cut:'✂️',help:'🤝',see:'🔮',skip:'⏭️',reverse:'🔄',attack:'⚔️',swap:'🔁',nope:'🚫'};
  const overlay=$('#effectOverlay');const involved=fx.role==='source'||fx.role==='target';
  overlay.className=`effect-overlay ${fx.type} card-${fx.card||'none'} role-${fx.role} ${involved?'involved':'observer'}`;
  $('#effectIcon').textContent=fx.type==='bomb-defuse'?'💣🛠️':fx.type==='bomb'?'💥':icons[fx.card]||'✨';
  const actors=$('#effectActors');
  if(fx.targetName)actors.textContent=`${fx.sourceName}  ${fx.card==='swap'?'VS':'→'}  ${fx.targetName}`;
  else actors.textContent=fx.sourceName||'';
  $('#effectTitle').textContent=involved?fx.title:(fx.targetName?`${fx.sourceName} ${fx.card==='swap'?'VS':'→'} ${fx.targetName}`:`${fx.sourceName} 使用了 ${fx.title}`);
  $('#effectSubtitle').textContent=fx.subtitle||(fx.targetName?`使用【${names[fx.card]||fx.title}】`:'');
  clearTimeout(renderEffect.timer);renderEffect.timer=setTimeout(()=>overlay.classList.add('hidden'),fx.type==='bomb'?2200:1700);
}
$('#chatForm').onsubmit=e=>{e.preventDefault();const input=$('#chatInput');const message=input.value.trim();if(!message)return;post('/api/chat',{message});input.value=''};
function addButton(parent,label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;parent.append(b)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
if(token){request('/api/state').then(()=>{$('#welcome').classList.add('hidden');$('#game').classList.remove('hidden');connect()}).catch(()=>{token='';localStorage.removeItem('boomcatToken')})}

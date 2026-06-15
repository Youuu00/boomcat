const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const sessions = new Map();
const streams = new Map();

const CARD_NAMES = {
  bomb: '炸弹', defuse: '拆除', cut: '切牌', help: '帮助', see: '查看',
  skip: '跳过', reverse: '转向', attack: '攻击', swap: '交换', nope: '禁止'
};

function id(bytes = 12) { return crypto.randomBytes(bytes).toString('hex'); }
function roomCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(code));
  return code;
}
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function living(room) { return room.players.filter(p => p.alive); }
function player(room, token) { return room.players.find(p => p.token === token); }
function current(room) { return room.players[room.turn]; }
function log(room, message) {
  room.log.unshift(message);
  room.log = room.log.slice(0, 30);
}
function effect(room, type, title, subtitle = '') {
  room.effect = { id: id(6), type, title, subtitle, issuedAt: Date.now() };
}
function nextAlive(room, from, step = room.direction) {
  let i = from;
  do i = (i + step + room.players.length) % room.players.length; while (!room.players[i].alive);
  return i;
}
function advance(room) {
  if (living(room).length <= 1) {
    room.status = 'finished';
    room.winner = living(room)[0]?.name || '无人';
    log(room, `${room.winner} 获胜！`);
    return;
  }
  // A dead player can never retain an extra turn. This matters when a player
  // draws a bomb during the first of two attacked turns.
  if (!current(room).alive) {
    room.extraTurns = 0;
    room.turn = nextAlive(room, room.turn);
    room.attackTurnOwner = null;
    room.attackTurnInitialExtra = 0;
  } else if (room.extraTurns > 0) {
    room.extraTurns--;
  } else {
    room.turn = nextAlive(room, room.turn);
    room.attackTurnOwner = null;
    room.attackTurnInitialExtra = 0;
  }
  room.phase = 'play';
  room.peek = null;
}
function finishIfNeeded(room) {
  if (room.status === 'playing' && living(room).length <= 1) {
    room.status = 'finished';
    room.winner = living(room)[0]?.name || '无人';
    room.pending = null;
    log(room, `${room.winner} 获胜！`);
    return true;
  }
  return false;
}
function leaveRoom(room, token) {
  const index = room.players.findIndex(p => p.token === token);
  if (index < 0) throw Error('你不在这个房间');
  const leaving = room.players[index];
  const oldTurn = room.turn;
  const wasCurrent = room.status === 'playing' && oldTurn === index;
  const pendingInvolved = room.pending && [room.pending.source, room.pending.target].includes(token);

  room.players.splice(index, 1);
  sessions.delete(token);
  if (pendingInvolved) {
    room.pending = null;
    log(room, '因相关玩家退出，待处理的卡牌操作已取消');
  }
  log(room, `${leaving.name} 退出了房间`);

  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.host === token) {
    room.host = room.players[0].token;
    room.players[0].ready = true;
    log(room, `${room.players[0].name} 成为了新房主`);
  }
  if (room.status !== 'playing') return;
  if (finishIfNeeded(room)) return;

  if (wasCurrent) {
    room.extraTurns = 0;
    room.attackTurnOwner = null;
    room.attackTurnInitialExtra = 0;
    room.phase = 'play';
    room.turn = room.direction === 1
      ? index % room.players.length
      : (index - 1 + room.players.length) % room.players.length;
  } else if (index < oldTurn) {
    room.turn = oldTurn - 1;
  }
}
function resetForRematch(room, token) {
  if (room.host !== token) throw Error('只有房主能发起下一局');
  if (room.status !== 'finished') throw Error('当前游戏还没有结束');
  room.status = 'lobby';
  room.deck = [];
  room.discard = [];
  room.pending = null;
  room.winner = null;
  room.phase = 'play';
  room.extraTurns = 0;
  room.attackTurnOwner = null;
  room.attackTurnInitialExtra = 0;
  room.effect = null;
  room.players.forEach(p => {
    p.hand = [];
    p.alive = true;
    p.ready = p.token === room.host;
    p.peek = null;
    p.pendingBomb = false;
    p.cancelAttackTurns = false;
  });
  log(room, '房主发起了下一局，请大家准备');
}
function buildDeck(count) {
  const quantities = { cut: 5, help: 6, see: 5, skip: 5, reverse: 5, attack: 5, swap: 4, nope: 5 };
  const deck = [];
  for (const [type, amount] of Object.entries(quantities)) {
    for (let i = 0; i < amount; i++) deck.push(type);
  }
  return shuffle(deck);
}
function startGame(room, token) {
  if (room.host !== token) throw Error('只有房主能开始');
  if (room.players.length < 2) throw Error('至少需要 2 名玩家');
  if (!room.players.every(p => p.ready || p.token === room.host)) throw Error('还有玩家未准备');
  let deck = buildDeck(room.players.length);
  room.players.forEach(p => {
    p.hand = deck.splice(0, 4);
    p.hand.push('defuse');
    p.alive = true;
    p.pendingBomb = false;
    p.cancelAttackTurns = false;
  });
  for (let i = 0; i < room.players.length - 1; i++) deck.push('bomb');
  room.deck = shuffle(deck);
  room.discard = [];
  room.direction = -1;
  room.turn = Math.floor(Math.random() * room.players.length);
  room.extraTurns = 0;
  room.attackTurnOwner = null;
  room.attackTurnInitialExtra = 0;
  room.status = 'playing';
  room.phase = 'play';
  room.winner = null;
  room.pending = null;
  room.effect = null;
  log(room, `游戏开始，${current(room).name} 先行动`);
}
function consume(p, type) {
  const i = p.hand.indexOf(type);
  if (i < 0) throw Error('你没有这张牌');
  p.hand.splice(i, 1);
}
function requireTurn(room, p) {
  if (room.status !== 'playing') throw Error('游戏尚未开始');
  if (current(room) !== p) throw Error('还没轮到你');
  if (!p.alive) throw Error('你已出局');
  if (room.pending) throw Error('请先处理当前操作');
}
function playCard(room, p, type, targetToken, options = {}) {
  requireTurn(room, p);
  if (['bomb', 'defuse', 'nope'].includes(type)) throw Error('这张牌不能主动使用');
  const target = player(room, targetToken);
  if (['help', 'attack', 'swap'].includes(type) && (!target || !target.alive)) throw Error('请选择存活玩家');
  if (['help', 'swap'].includes(type) && target === p) throw Error('不能对自己使用这张牌');
  let cutCount = 0;
  if (type === 'cut') {
    cutCount = Number(options.count);
    if (!Number.isInteger(cutCount) || cutCount < 1 || cutCount > room.deck.length) {
      throw Error(`切牌数量必须在 1～${room.deck.length} 之间`);
    }
  }
  consume(p, type);
  room.discard.push(type);
  log(room, `${p.name} 使用了【${CARD_NAMES[type]}】${target ? `，目标是 ${target.name}` : ''}`);

  if (type === 'see') p.peek = room.deck.slice(0, 3);
  if (type === 'cut') {
    room.deck = room.deck.slice(-cutCount).concat(room.deck.slice(0, -cutCount));
    log(room, `${p.name} 将牌堆底部 ${cutCount} 张牌切到了顶部`);
  }
  if (type === 'skip') advance(room);
  if (type === 'reverse') { room.direction *= -1; advance(room); }
  if (type === 'help') room.pending = { type: 'help', source: p.token, target: target.token };
  if (type === 'swap') room.pending = { type: 'swap', source: p.token, target: target.token };
  if (type === 'attack') room.pending = {
    type: 'attack', source: p.token, target: target.token,
    chain: [{ source: p.token, target: target.token }]
  };
}
function stackAttack(room, actor, targetToken) {
  const pending = room.pending;
  if (!pending || pending.type !== 'attack' || pending.target !== actor.token) throw Error('当前没有可叠加的攻击');
  const target = player(room, targetToken);
  if (!target || !target.alive) throw Error('请选择存活玩家');
  consume(actor, 'attack');
  room.discard.push('attack');
  pending.chain.push({ source: actor.token, target: target.token });
  pending.source = actor.token;
  pending.target = target.token;
  log(room, `${actor.name} 叠加【攻击】给 ${target.name}，累计 ${pending.chain.length + 1} 个回合`);
  effect(room, 'attack-stack', '攻击叠加！', `${target.name} 面临 ${pending.chain.length + 1} 个连续回合`);
}
function resolvePending(room, actor, action, cardIndex) {
  const pending = room.pending;
  if (!pending || pending.target !== actor.token) throw Error('没有需要你处理的操作');
  const source = player(room, pending.source);
  if (action === 'nope') {
    consume(actor, 'nope');
    room.discard.push('nope');
    if (pending.type === 'attack' && pending.chain?.length > 1) {
      const blocked = pending.chain.pop();
      const previous = pending.chain[pending.chain.length - 1];
      pending.source = previous.source;
      pending.target = previous.target;
      log(room, `${actor.name} 使用【禁止】，只阻止了 ${player(room, blocked.source)?.name || '上一位玩家'} 叠加的攻击`);
    } else {
      log(room, `${actor.name} 使用【禁止】，当前卡牌操作失效`);
      room.pending = null;
    }
    return;
  }
  if (pending.type === 'help') {
    if (!Number.isInteger(cardIndex) || !actor.hand[cardIndex]) throw Error('请选择要交出的牌');
    const [card] = actor.hand.splice(cardIndex, 1);
    source.hand.push(card);
    log(room, `${actor.name} 交给 ${source.name} 一张牌`);
  } else if (pending.type === 'swap') {
    [actor.hand, source.hand] = [source.hand, actor.hand];
    log(room, `${actor.name} 与 ${source.name} 交换了全部手牌`);
  } else if (pending.type === 'attack') {
    room.turn = room.players.indexOf(actor);
    room.extraTurns = pending.chain?.length || 1;
    room.attackTurnOwner = actor.token;
    room.attackTurnInitialExtra = room.extraTurns;
    room.phase = 'play';
    log(room, `${actor.name} 将连续进行 ${room.extraTurns + 1} 个回合`);
  }
  room.pending = null;
}
function draw(room, p) {
  requireTurn(room, p);
  const card = room.deck.shift();
  if (!card) throw Error('牌堆空了');
  if (card !== 'bomb') {
    p.hand.push(card);
    log(room, `${p.name} 摸了一张牌`);
    advance(room);
    return;
  }
  log(room, `${p.name} 摸到了炸弹！`);
  effect(room, 'bomb', 'BOOM！摸到炸弹！', `${p.name} 的命运正在判定`);
  if (p.hand.includes('defuse')) {
    consume(p, 'defuse');
    room.discard.push('defuse');
    room.phase = 'defuse';
    p.pendingBomb = true;
    p.cancelAttackTurns = room.attackTurnOwner === p.token;
    log(room, `${p.name} 使用了【拆除】，正在放回炸弹`);
  } else {
    p.alive = false;
    room.discard.push('bomb');
    log(room, `${p.name} 被炸出局`);
    advance(room);
  }
}
function insertBomb(room, p, position) {
  if (current(room) !== p || room.phase !== 'defuse' || !p.pendingBomb) throw Error('当前无需放置炸弹');
  const maxPosition = room.deck.length + 1;
  const chosen = Number(position);
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > maxPosition) throw Error(`放置位置必须在 1～${maxPosition} 之间`);
  const at = chosen - 1;
  room.deck.splice(at, 0, 'bomb');
  p.pendingBomb = false;
  log(room, `${p.name} 已将炸弹放到牌堆第 ${chosen} 张`);
  if (p.cancelAttackTurns) {
    room.extraTurns = 0;
    p.cancelAttackTurns = false;
    log(room, `${p.name} 拆除炸弹，剩余的受攻击回合被取消`);
  }
  advance(room);
}
function sendChat(room, p, message) {
  const text = String(message || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!text) throw Error('消息不能为空');
  if (!room.chat) room.chat = [];
  room.chat.push({ id: id(6), name: p.name, text, alive: p.alive, at: Date.now() });
  room.chat = room.chat.slice(-80);
}
function publicState(room, token) {
  const me = player(room, token);
  return {
    code: room.code, status: room.status, host: room.host === token,
    direction: room.direction, turnToken: room.status === 'playing' ? current(room)?.token : null,
    turnName: room.status === 'playing' ? current(room)?.name : null,
    deckCount: room.deck.length, phase: room.phase, winner: room.winner, log: room.log,
    effect: room.effect || null, chat: room.chat || [],
    pending: room.pending ? { type: room.pending.type, targetMe: room.pending.target === token, sourceName: player(room, room.pending.source)?.name, attackDepth: room.pending.chain?.length || 0 } : null,
    players: room.players.map(p => ({ token: p.token, name: p.name, ready: p.ready, alive: p.alive, cards: p.hand.length, host: p.token === room.host })),
    me: me ? { token, hand: me.hand, alive: me.alive, peek: me.peek || null, pendingBomb: !!me.pendingBomb } : null
  };
}
function broadcast(room) {
  for (const p of room.players) {
    const set = streams.get(p.token);
    if (!set) continue;
    const data = `data: ${JSON.stringify(publicState(room, p.token))}\n\n`;
    for (const res of set) res.write(data);
  }
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100000) throw Error('请求过大');
  }
  return raw ? JSON.parse(raw) : {};
}
function auth(req) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const code = sessions.get(token);
  const room = rooms.get(code);
  if (!token || !room || !player(room, token)) throw Error('登录状态已失效');
  return { token, room, p: player(room, token) };
}
async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/create') {
    const data = await body(req); const token = id(); const code = roomCode();
    const name = String(data.name || '').trim().slice(0, 12);
    if (!name) throw Error('请输入昵称');
    const room = { code, host: token, players: [{ token, name, ready: true, alive: true, hand: [] }], status: 'lobby', deck: [], discard: [], log: [`${name} 创建了房间`], chat: [], effect: null, direction: -1, phase: 'play', pending: null };
    rooms.set(code, room); sessions.set(token, code); json(res, 200, { token, code }); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    const data = await body(req); const room = rooms.get(String(data.code || '').trim());
    const name = String(data.name || '').trim().slice(0, 12);
    if (!room || room.status !== 'lobby') throw Error('房间不存在或游戏已开始');
    if (!name) throw Error('请输入昵称');
    if (room.players.length >= 6) throw Error('房间已满');
    if (room.players.some(p => p.name === name)) throw Error('昵称已被使用');
    const token = id(); room.players.push({ token, name, ready: false, alive: true, hand: [] }); sessions.set(token, room.code);
    log(room, `${name} 加入了房间`); json(res, 200, { token, code: room.code }); broadcast(room); return;
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const token = url.searchParams.get('token');
    const room = rooms.get(sessions.get(token));
    if (!token || !room || !player(room, token)) throw Error('登录状态已失效');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(publicState(room, token))}\n\n`);
    if (!streams.has(token)) streams.set(token, new Set()); streams.get(token).add(res);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      streams.get(token)?.delete(res);
    });
    return;
  }
  const { token, room, p } = auth(req); const data = req.method === 'POST' ? await body(req) : {};
  if (url.pathname === '/api/state') json(res, 200, publicState(room, token));
  else if (url.pathname === '/api/ready') { if (room.status !== 'lobby') throw Error('游戏已开始'); p.ready = !p.ready; json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/start') { startGame(room, token); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/rematch') { resetForRematch(room, token); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/leave') {
    leaveRoom(room, token);
    json(res, 200, { ok: true });
    const set = streams.get(token);
    if (set) for (const stream of set) stream.end();
    streams.delete(token);
    if (rooms.has(room.code)) broadcast(room);
  }
  else if (url.pathname === '/api/play') { playCard(room, p, data.type, data.target, data); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/stack-attack') { stackAttack(room, p, data.target); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/resolve') { resolvePending(room, p, data.action, data.cardIndex); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/draw') { draw(room, p); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/bomb') { insertBomb(room, p, data.position); json(res, 200, { ok: true }); broadcast(room); }
  else if (url.pathname === '/api/chat') { sendChat(room, p, data.message); json(res, 200, { ok: true }); broadcast(room); }
  else json(res, 404, { error: '接口不存在' });
}
function staticFile(req, res, url) {
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(PUBLIC, name);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, rooms: rooms.size, uptime: Math.floor(process.uptime()) });
    } else if (url.pathname.startsWith('/api/')) {
      await api(req, res, url);
    } else {
      staticFile(req, res, url);
    }
  }
  catch (e) { json(res, 400, { error: e.message || '操作失败' }); }
});
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Boom Cat running at http://0.0.0.0:${PORT}`));
}

module.exports = { advance, leaveRoom, resetForRematch, playCard, stackAttack, resolvePending, insertBomb, sendChat };

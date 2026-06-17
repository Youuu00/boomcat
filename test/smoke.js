const { spawn } = require('child_process');
const assert = require('assert');
const { advance, leaveRoom, resetForRematch, playCard, stackAttack, resolvePending, insertBomb, sendChat, publicState, draw, buildDeck } = require('../server');

const port = 3187;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: require('path').join(__dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

async function post(path, data, token) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data)
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error);
  return body;
}

async function run() {
  const makeRuleRoom = () => ({
    players: [
      { token: 'a', name: '甲', alive: true, ready: true, hand: [] },
      { token: 'b', name: '乙', alive: true, ready: true, hand: [] },
      { token: 'c', name: '丙', alive: true, ready: true, hand: [] }
    ],
    turn: 0, direction: 1, extraTurns: 0, status: 'playing', phase: 'play',
    pending: null, deck: [], discard: [], log: [], chat: [], effect: null
  });

  const typeOf = card => typeof card === 'string' ? card : card.type;
  const normalDeck = buildDeck(3, 'normal').map(typeOf);
  assert.equal(normalDeck.filter(type => type === 'bomb').length, 2);
  assert.equal(normalDeck.some(type => type === 'invisibleBomb' || type === 'delayBomb'), false);
  assert.equal(normalDeck.some(type => type.startsWith('adv_')), false);
  for (let players = 2; players <= 6; players++) {
    for (let i = 0; i < 30; i++) {
      const deck = buildDeck(players, 'advanced').map(typeOf);
      const bombs = deck.filter(type => ['bomb', 'invisibleBomb', 'delayBomb'].includes(type));
      assert.equal(bombs.length, players - 1);
      assert.equal(bombs.filter(type => type === 'bomb').length >= 1, true);
      assert.equal(bombs.filter(type => type === 'invisibleBomb').length <= 1, true);
      assert.equal(bombs.filter(type => type === 'delayBomb').length <= 1, true);
      assert.equal(deck.filter(type => type.startsWith('adv_')).length, 5);
    }
  }

  const seeRoom = makeRuleRoom();
  seeRoom.players[0].hand = ['see'];
  seeRoom.deck = ['skip', 'bomb', { type: 'invisibleBomb', mask: 'help' }];
  playCard(seeRoom, seeRoom.players[0], 'see');
  assert.deepEqual(seeRoom.players[0].peek, ['skip', 'bomb', 'help']);

  const lockedDefuseRoom = makeRuleRoom();
  lockedDefuseRoom.players[0].hand = ['skip'];
  lockedDefuseRoom.players[0].pendingBomb = true;
  lockedDefuseRoom.phase = 'defuse';
  assert.throws(() => playCard(lockedDefuseRoom, lockedDefuseRoom.players[0], 'skip'), /请先把炸弹放回牌堆/);

  const cutRoom = makeRuleRoom();
  cutRoom.players[0].hand = ['cut'];
  cutRoom.deck = ['一', '二', '三', '四'];
  playCard(cutRoom, cutRoom.players[0], 'cut', null, { count: 2 });
  assert.deepEqual(cutRoom.deck, ['三', '四', '一', '二']);

  const stackedRoom = makeRuleRoom();
  stackedRoom.players[0].hand = ['attack'];
  stackedRoom.players[1].hand = ['attack'];
  playCard(stackedRoom, stackedRoom.players[0], 'attack', 'b');
  assert.equal(publicState(stackedRoom, 'a').effect.role, 'source');
  assert.equal(publicState(stackedRoom, 'b').effect.role, 'target');
  assert.equal(publicState(stackedRoom, 'c').effect.role, 'observer');
  assert.equal(stackedRoom.effect.card, 'attack');
  stackAttack(stackedRoom, stackedRoom.players[1], 'c');
  assert.throws(() => stackAttack(stackedRoom, stackedRoom.players[2], 'a'), /攻击只能叠加一次/);
  resolvePending(stackedRoom, stackedRoom.players[2], 'accept');
  assert.equal(stackedRoom.turn, 2);
  assert.equal(stackedRoom.extraTurns, 2);

  const blockedStackRoom = makeRuleRoom();
  blockedStackRoom.players[0].hand = ['attack'];
  blockedStackRoom.players[1].hand = ['attack'];
  blockedStackRoom.players[2].hand = ['nope'];
  playCard(blockedStackRoom, blockedStackRoom.players[0], 'attack', 'b');
  stackAttack(blockedStackRoom, blockedStackRoom.players[1], 'c');
  resolvePending(blockedStackRoom, blockedStackRoom.players[2], 'nope');
  assert.equal(blockedStackRoom.pending, null);
  assert.equal(blockedStackRoom.turn, 1);
  assert.equal(blockedStackRoom.extraTurns, 1);

  const advancedSwapRoom = makeRuleRoom();
  advancedSwapRoom.players[0].hand = ['adv_swap', '一'];
  advancedSwapRoom.players[1].hand = ['nope', '二'];
  playCard(advancedSwapRoom, advancedSwapRoom.players[0], 'adv_swap', 'b');
  assert.equal(advancedSwapRoom.effect.card, 'swap');
  assert.equal(advancedSwapRoom.log[0].includes('高级交换'), false);
  resolvePending(advancedSwapRoom, advancedSwapRoom.players[1], 'nope');
  assert.deepEqual(advancedSwapRoom.players[0].hand.map(String), ['二']);
  assert.deepEqual(advancedSwapRoom.players[1].hand.map(String), ['一']);

  const emptyDeckDelayRoom = makeRuleRoom();
  emptyDeckDelayRoom.players = emptyDeckDelayRoom.players.slice(0, 2);
  emptyDeckDelayRoom.players[0].hand = [];
  emptyDeckDelayRoom.players[1].hand = [{ type: 'delayBomb' }, 'defuse'];
  emptyDeckDelayRoom.deck = ['skip'];
  emptyDeckDelayRoom.turn = 0;
  draw(emptyDeckDelayRoom, emptyDeckDelayRoom.players[0]);
  assert.equal(emptyDeckDelayRoom.phase, 'defuse');
  assert.equal(emptyDeckDelayRoom.turn, 1);
  assert.equal(emptyDeckDelayRoom.players[1].pendingBomb, true);
  insertBomb(emptyDeckDelayRoom, emptyDeckDelayRoom.players[1], 1);
  assert.equal(emptyDeckDelayRoom.turn, 0);
  assert.equal(emptyDeckDelayRoom.phase, 'play');
  assert.equal(emptyDeckDelayRoom.deck[0].type, 'delayBomb');

  const delayTransferRoom = makeRuleRoom();
  const delayCard = { type: 'delayBomb' };
  delayTransferRoom.players[0].hand = ['help', 'defuse'];
  delayTransferRoom.players[1].hand = [delayCard, 'defuse'];
  playCard(delayTransferRoom, delayTransferRoom.players[0], 'help', 'b');
  resolvePending(delayTransferRoom, delayTransferRoom.players[1], 'accept', 0);
  assert.equal(delayTransferRoom.players[0].hand.some(c => c.type === 'delayBomb'), true);
  delayTransferRoom.turn = 0;
  delayTransferRoom.deck = ['skip'];
  draw(delayTransferRoom, delayTransferRoom.players[0]);
  assert.equal(delayTransferRoom.phase, 'defuse');
  assert.equal(delayTransferRoom.players[0].pendingBomb, true);

  const delaySkipRoom = makeRuleRoom();
  delaySkipRoom.players[0].hand = [{ type: 'delayBomb' }, 'skip'];
  delaySkipRoom.deck = ['cut'];
  playCard(delaySkipRoom, delaySkipRoom.players[0], 'skip');
  assert.equal(delaySkipRoom.phase, 'play');
  assert.equal(!!delaySkipRoom.players[0].pendingBomb, false);
  assert.equal(delaySkipRoom.players[0].hand.some(c => c.type === 'delayBomb'), true);

  const bombPositionRoom = makeRuleRoom();
  bombPositionRoom.players[0].pendingBomb = true;
  bombPositionRoom.phase = 'defuse';
  bombPositionRoom.deck = ['一', '二'];
  insertBomb(bombPositionRoom, bombPositionRoom.players[0], 1);
  assert.deepEqual(bombPositionRoom.deck, ['bomb', '一', '二']);
  assert.equal(bombPositionRoom.log.some(message => message.includes('第 1 张')), false);
  assert.equal(bombPositionRoom.log[0], '甲 已将炸弹秘密放回牌堆');

  const cancelAttackRoom = makeRuleRoom();
  cancelAttackRoom.players[0].pendingBomb = true;
  cancelAttackRoom.players[0].cancelAttackTurns = true;
  cancelAttackRoom.phase = 'defuse';
  cancelAttackRoom.extraTurns = 2;
  cancelAttackRoom.deck = ['一', '二'];
  insertBomb(cancelAttackRoom, cancelAttackRoom.players[0], 3);
  assert.equal(cancelAttackRoom.turn, 1);
  assert.equal(cancelAttackRoom.extraTurns, 0);
  assert.deepEqual(cancelAttackRoom.deck, ['一', '二', 'bomb']);

  const laterBombRoom = makeRuleRoom();
  laterBombRoom.players[0].pendingBomb = true;
  laterBombRoom.players[0].cancelAttackTurns = true;
  laterBombRoom.phase = 'defuse';
  laterBombRoom.extraTurns = 1;
  laterBombRoom.attackTurnOwner = 'a';
  laterBombRoom.attackTurnInitialExtra = 2;
  laterBombRoom.deck = ['一'];
  insertBomb(laterBombRoom, laterBombRoom.players[0], 2);
  assert.equal(laterBombRoom.turn, 1);
  assert.equal(laterBombRoom.extraTurns, 0);

  const deadSpeakerRoom = makeRuleRoom();
  deadSpeakerRoom.players[1].alive = false;
  sendChat(deadSpeakerRoom, deadSpeakerRoom.players[1], '我虽然出局了，但还能聊天');
  assert.equal(deadSpeakerRoom.chat[0].alive, false);
  assert.equal(deadSpeakerRoom.chat[0].text, '我虽然出局了，但还能聊天');

  const attackedRoom = {
    players: [
      { name: '甲', alive: true },
      { name: '乙', alive: false },
      { name: '丙', alive: true }
    ],
    turn: 1,
    direction: -1,
    extraTurns: 1,
    status: 'playing',
    phase: 'play',
    log: []
  };
  advance(attackedRoom);
  assert.equal(attackedRoom.turn, 0);
  assert.equal(attackedRoom.extraTurns, 0);

  const finalRoom = {
    players: [
      { name: '甲', alive: true },
      { name: '乙', alive: false },
      { name: '丙', alive: false }
    ],
    turn: 2,
    direction: -1,
    extraTurns: 0,
    status: 'playing',
    phase: 'play',
    log: []
  };
  advance(finalRoom);
  assert.equal(finalRoom.status, 'finished');
  assert.equal(finalRoom.winner, '甲');

  const leaveTestRoom = {
    code: 'unit-room',
    host: 'a',
    players: [
      { token: 'a', name: '甲', alive: true, ready: true, hand: [] },
      { token: 'b', name: '乙', alive: true, ready: true, hand: [] },
      { token: 'c', name: '丙', alive: true, ready: true, hand: [] }
    ],
    turn: 1,
    direction: -1,
    extraTurns: 1,
    status: 'playing',
    phase: 'play',
    pending: null,
    log: []
  };
  leaveRoom(leaveTestRoom, 'b');
  assert.equal(leaveTestRoom.players.length, 2);
  assert.equal(leaveTestRoom.players[leaveTestRoom.turn].token, 'a');
  assert.equal(leaveTestRoom.extraTurns, 0);
  leaveRoom(leaveTestRoom, 'a');
  assert.equal(leaveTestRoom.host, 'c');
  assert.equal(leaveTestRoom.status, 'finished');
  assert.equal(leaveTestRoom.winner, '丙');

  resetForRematch(leaveTestRoom, 'c');
  assert.equal(leaveTestRoom.status, 'lobby');
  assert.equal(leaveTestRoom.winner, null);
  assert.equal(leaveTestRoom.players[0].ready, true);
  assert.equal(leaveTestRoom.players[0].hand.length, 0);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('服务器启动超时')), 3000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', reject);
  });
  const healthResponse = await fetch(base + '/health');
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.ok, true);
  const a = await post('/api/create', { name: '玩家甲' });
  const b = await post('/api/join', { name: '玩家乙', code: a.code });
  await post('/api/ready', {}, b.token);
  await post('/api/start', {}, a.token);
  const response = await fetch(base + '/api/state', { headers: { Authorization: `Bearer ${a.token}` } });
  const state = await response.json();
  assert.equal(state.status, 'playing');
  assert.equal(state.players.length, 2);
  assert.equal(state.me.hand.length, 5);
  assert.equal(state.me.hand.filter(card => card === 'defuse').length, 1);
  assert.equal(state.deckCount + state.players.reduce((sum, item) => sum + item.cards, 0), 22);
  assert.equal(state.deckCount, 12);
  await post('/api/leave', {}, b.token);
  const finishedResponse = await fetch(base + '/api/state', { headers: { Authorization: `Bearer ${a.token}` } });
  const finishedState = await finishedResponse.json();
  assert.equal(finishedState.status, 'finished');
  assert.equal(finishedState.winner, '玩家甲');
  await post('/api/rematch', {}, a.token);
  const rematchResponse = await fetch(base + '/api/state', { headers: { Authorization: `Bearer ${a.token}` } });
  const rematchState = await rematchResponse.json();
  assert.equal(rematchState.status, 'lobby');
  assert.equal(rematchState.me.hand.length, 0);
  console.log(`PASS 房间 ${a.code}：开局、退出、胜利判定和再来一局流程正常`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.kill());

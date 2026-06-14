const { spawn } = require('child_process');
const assert = require('assert');
const { advance, leaveRoom, resetForRematch } = require('../server');

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
  assert.equal(state.deckCount, 33);
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

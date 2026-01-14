'use strict';

const debug = require('debug');
const { JsonDB } = require('./jsondb');

const dlogError = debug('bot:error');
const db = new JsonDB();

/**
 * This file replaces the original PostgreSQL implementation with a JSON file DB.
 * Public API is kept compatible with the old ./base/database.js exports, so the
 * gameplay and plugins can remain unchanged.
 *
 * Tables:
 * - users: { [id:string]: UserRow }
 * - clans: { [id:string]: ClanRow }
 * - stats: Array<{ id:number, time:number, invite?:number }>
 *
 * Notes:
 * - "time" fields are stored as epoch milliseconds.
 * - getUser/randomUser/topUsers etc compute derived fields (timerunning, run)
 *   the same way SQL did: now() - time.
 */

const DEFAULTS = {
  lang: 'en',
  opponent: 1,
  dual: 50,
  reply: true,
  notification: true,
  type: 'warrior',
  level: 1,
  attack: 50,
  shield: 50,
  life: 50,
  money: 100,
  qt_bank: 1,
  qt_hospital: 1,
  qt_bomb: 1,
  qt_rocket: 1,
  qt_towerdefense: 1,
  qt_zonewar: 1,
  qt_zonedefense: 1,
  xp: 0,
  troops: 5,
  inventory: [3, 2, 3, 2, 3, 2, 7, 7, 6, 6, 10, 11],
  city: [
    5, 0, 0, 0, 4,
    0, 1, 0, 3, 0,
    0, 0, 0, 0, 0,
    0, 0, 2, 0, 0,
    4, 0, 0, 0, 5
  ],
  invite: 0
};

function nowMs() {
  return Date.now();
}

function withDerived(user) {
  if (!user) return user;
  const time = Number(user.time || 0);
  const timerunning = time ? Math.floor((nowMs() - time) / 1000) : 0;
  return {
    ...user,
    timerunning,
    run: timerunning > 120
  };
}

function getUsersTable() {
  return db.load('users', {});
}

function getClansTable() {
  return db.load('clans', {});
}

function getStatsTable() {
  return db.load('stats', []);
}

async function getUser(id) {
  const users = getUsersTable();
  const u = users[String(id)];
  return u ? withDerived(u) : false;
}

async function setUser(id, name) {
  const users = getUsersTable();
  const key = String(id);

  if (users[key]) return withDerived(users[key]);

  const row = {
    id: Number(id),
    name: String(name || 'Unknown'),
    ...DEFAULTS,
    time: nowMs()
  };

  users[key] = row;
  db.save('users');

  // join stats log
  const stats = getStatsTable();
  stats.push({ id: Number(id), time: nowMs(), invite: 0 });
  db.save('stats');

  return withDerived(row);
}

async function updateUser(id, row, value) {
  const users = getUsersTable();
  const key = String(id);
  if (!users[key]) return false;

  users[key][row] = value;
  db.save('users');
  return withDerived(users[key]);
}

async function setCity(ctx, pos, id) {
  const users = getUsersTable();
  const key = String(ctx.from.id);
  const u = users[key];
  if (!u) return false;

  const city = Array.isArray(ctx.db.city) ? [...ctx.db.city] : [...(u.city || DEFAULTS.city)];
  city[pos] = id;

  u.city = city;
  u.time = nowMs();
  users[key] = u;
  db.save('users');
  return withDerived(u);
}

async function replaceInventory(ctx, pos, to) {
  const users = getUsersTable();
  const key = String(ctx.from.id);
  const u = users[key];
  if (!u) return false;

  const inventory = (ctx.db.inventory || u.inventory || DEFAULTS.inventory).map(e => Number(e));
  const index = inventory.indexOf(Number(to));
  if (index < 0) return false;

  const city = ctx.db.city || u.city || DEFAULTS.city;
  inventory[index] = Number(city[pos]);

  u.inventory = inventory;
  u.time = nowMs();
  users[key] = u;
  db.save('users');
  return withDerived(u);
}

async function saveUser(ctx) {
  const users = getUsersTable();
  const key = String(ctx.from.id);
  const u = users[key];
  if (!u) return false;

  const whiteList = new Set([
    'dual',
    'lang',
    'inventory',
    'opponent',
    'reply',
    'notification',
    'type',
    'level',
    'attack',
    'shield',
    'life',
    'money',
    'qt_bank',
    'qt_hospital',
    'qt_bomb',
    'qt_rocket',
    'qt_towerdefense',
    'qt_zonewar',
    'qt_zonedefense',
    'xp',
    'troops',
    'city',
    'invite'
  ]);

  for (const k of Object.keys(ctx.db || {})) {
    if (!whiteList.has(k)) continue;
    u[k] = ctx.db[k];
  }

  u.time = nowMs();
  users[key] = u;
  db.save('users');
  return withDerived(u);
}

async function saveAtack(playId, playXp, ctx, opponent) {
  const users = getUsersTable();

  const key1 = String(playId);
  const key2 = String(opponent);

  if (!users[key1] || !users[key2]) return false;

  users[key1].xp = Number(playXp);
  users[key1].money = Number(ctx.db.money);
  users[key1].opponent = Number(opponent);
  users[key1].troops = Number(ctx.db.troops);
  // NOTE: original SQL didn't update time here; main flow usually calls saveUser
  db.save('users');

  return withDerived(users[key1]);
}

async function getStats24() {
  const users = getUsersTable();
  const cutoff = nowMs() - 24 * 60 * 60 * 1000;
  // mimic SQL: users where time < now - 24h
  return Object.values(users).filter(u => Number(u.time || 0) < cutoff).map(withDerived);
}

async function getJoin24() {
  const stats = getStatsTable();
  const cutoff = nowMs() - 24 * 60 * 60 * 1000;
  return stats.filter(s => Number(s.time || 0) >= cutoff);
}

async function getAllUsers() {
  return db.allRows('users').map(withDerived);
}

async function joinUserInvite(id, invite) {
  const stats = getStatsTable();
  stats.push({ id: Number(id), time: nowMs(), invite: Number(invite) });
  db.save('stats');
  return true;
}

async function findAllTable(name) {
  if (name === 'users') return db.allRows('users').map(withDerived);
  if (name === 'clans') return db.allRows('clans');
  if (name === 'stats') return db.allRows('stats');
  return db.allRows(name);
}

async function getDual() {
  const users = getUsersTable();
  return Object.values(users)
    .filter(u => Number(u.dual) < 50)
    .map(withDerived);
}

async function saveAtackDual(play1, play2) {
  const users = getUsersTable();
  const k1 = String(play1.id);
  const k2 = String(play2.id);

  if (!users[k1] || !users[k2]) return false;

  users[k1].xp = Number(play1.xp);
  users[k1].money = Number(play1.money);
  users[k1].dual = Number(play1.dual);
  users[k1].troops = Number(play1.troops);

  users[k2].xp = Number(play2.xp);
  users[k2].money = Number(play2.money);
  users[k2].dual = Number(play2.dual);
  users[k2].troops = Number(play2.troops);

  db.save('users');
  return true;
}

async function createClan(clan) {
  const clans = getClansTable();
  const key = String(clan.id);
  if (clans[key]) return clans[key];

  const row = {
    id: Number(clan.id),
    name: String(clan.name),
    flag: String(clan.flag),
    chat: clan.chat ? String(clan.chat) : '',
    desc: clan.desc ? String(clan.desc) : '',
    members: Array.isArray(clan.members) ? clan.members.map(Number) : [],
    level: Number(clan.level || 1),
    xp: Number(clan.xp || 1),
    money: Number(clan.money || 1),
    time: nowMs()
  };

  clans[key] = row;
  db.save('clans');
  return row;
}

async function getClan(id) {
  const clans = getClansTable();
  return clans[String(id)] || false;
}

async function updateClan(id, row, value) {
  const clans = getClansTable();
  const key = String(id);
  if (!clans[key]) return false;
  clans[key][row] = value;
  db.save('clans');
  return clans[key];
}

async function getClans() {
  return db.allRows('clans');
}

function sortByKeyDesc(rows, key) {
  return [...rows].sort((a, b) => (Number(b[key] || 0) - Number(a[key] || 0)));
}

async function topUsers(id, row = 'money') {
  const users = db.allRows('users').map(withDerived);
  const sorted = sortByKeyDesc(users, row);

  // emulate SQL ranking (dense-ish): just index+1
  const withPos = sorted.map((u, i) => ({ ...u, position: i + 1 }));
  const me = withPos.find(u => String(u.id) === String(id));
  const top10 = withPos.slice(0, 10);

  // SQL returned top10 + me if not in top10
  if (me && !top10.find(u => String(u.id) === String(id))) {
    top10.push(me);
  }
  return top10;
}

async function randomUser(max = 10) {
  const users = db.allRows('users');
  const arr = users.slice();
  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, max).map(withDerived);
}

async function topClans(id, row = 'money') {
  const clans = db.allRows('clans');
  const sorted = sortByKeyDesc(clans, row);
  const withPos = sorted.map((c, i) => ({ ...c, position: i + 1 }));
  const me = withPos.find(c => String(c.id) === String(id));
  const top10 = withPos.slice(0, 10);
  if (me && !top10.find(c => String(c.id) === String(id))) top10.push(me);
  return top10;
}

module.exports = {
  getUser,
  setUser,
  updateUser,
  topUsers,
  randomUser,
  setCity,
  replaceInventory,
  saveUser,
  saveAtack,
  getStats24,
  getJoin24,
  getAllUsers,
  joinUserInvite,
  findAllTable,
  getDual,
  saveAtackDual,
  createClan,
  getClan,
  updateClan,
  getClans,
  topClans
};

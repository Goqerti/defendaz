'use strict';

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { DB_DIR } = require('../base/jsondb');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const out = path.join(DB_DIR, file);
  const tmp = out + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, out);
  console.log('✅ wrote', out);
}

/**
 * Restore JSON DB from backup files created by /backup plugin.
 *
 * Usage:
 *   node scripts/restore.js --users Users.backup.JSON --stats Stats.backup.JSON --clans Clans.backup.JSON
 *
 * If you omit a flag, that table is not overwritten.
 */
const argv = minimist(process.argv.slice(2));

if (!argv.users && !argv.stats && !argv.clans) {
  console.log('Usage: node scripts/restore.js --users <file> --stats <file> --clans <file>');
  process.exit(1);
}

if (argv.users) {
  const usersArr = readJson(argv.users);
  // backup plugin sends an array of rows; store as map by id
  const users = {};
  for (const u of usersArr) users[String(u.id)] = u;
  writeJson('users.json', users);
}

if (argv.clans) {
  const clansArr = readJson(argv.clans);
  const clans = {};
  for (const c of clansArr) clans[String(c.id)] = c;
  writeJson('clans.json', clans);
}

if (argv.stats) {
  const statsArr = readJson(argv.stats);
  writeJson('stats.json', statsArr);
}

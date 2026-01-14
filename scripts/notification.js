'use strict';

const minimist = require('minimist');
const Telegraf = require('telegraf');
require('../base/config');
const database = require('../base/database');

/**
 * Simple notification broadcaster using JSON DB.
 *
 * Usage:
 *   BOT_TOKEN=... node scripts/notification.js --text "Hello!"
 */
const argv = minimist(process.argv.slice(2));
const token = process.env.BOT_TOKEN || process.env.TOKEN;
const text = argv.text || argv._.join(' ');

if (!token) {
  console.error('Missing BOT_TOKEN (or TOKEN) env var.');
  process.exit(1);
}
if (!text) {
  console.error('Usage: node scripts/notification.js --text "Your message"');
  process.exit(1);
}

const bot = new Telegraf(token);

(async () => {
  const users = await database.getAllUsers();
  let ok = 0;
  let fail = 0;

  for (const u of users) {
    try {
      await bot.telegram.sendMessage(u.id, text);
      ok++;
    } catch (e) {
      fail++;
    }
  }

  console.log(`Done. Sent=${ok}, Failed=${fail}`);
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});

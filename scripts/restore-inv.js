'use strict';

const { JsonDB } = require('../base/jsondb');

const db = new JsonDB();

const users = db.load('users', {});
let changed = 0;

for (const [id, u] of Object.entries(users)) {
  if (!u) continue;
  if (Array.isArray(u.inventory)) {
    const inv = u.inventory.map(n => Number(n));
    if (JSON.stringify(inv) !== JSON.stringify(u.inventory)) {
      u.inventory = inv;
      changed++;
    }
  }
  if (Array.isArray(u.city)) {
    const city = u.city.map(n => Number(n));
    if (JSON.stringify(city) !== JSON.stringify(u.city)) {
      u.city = city;
      changed++;
    }
  }
  users[id] = u;
}

db.save('users');

console.log(`✅ restore-inv done. changed=${changed}`);

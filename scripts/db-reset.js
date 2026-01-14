'use strict';

const fs = require('fs');
const path = require('path');
const { DB_DIR } = require('../base/jsondb');

function rmSafe(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}

rmSafe(DB_DIR);
fs.mkdirSync(DB_DIR, { recursive: true });

console.log('✅ JSON DB reset:', DB_DIR);

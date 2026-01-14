'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON DB (file-based) with atomic writes.
 * - Stores each "table" as a single JSON file.
 * - Loads on demand and caches in memory.
 * - Persists changes immediately.
 *
 * This is intentionally simple and dependency-free.
 */

const DB_DIR = process.env.JSON_DB_DIR || path.join(__dirname, '..', 'db');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return fallback;
    // If JSON is corrupted, keep a copy and start fresh to avoid crashing the bot.
    try {
      const badPath = filePath + '.corrupted.' + Date.now();
      fs.copyFileSync(filePath, badPath);
    } catch (_) {}
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

class JsonDB {
  constructor() {
    ensureDir(DB_DIR);
    this._cache = new Map(); // tableName -> data
  }

  _file(table) {
    return path.join(DB_DIR, `${table}.json`);
  }

  load(table, fallback) {
    if (this._cache.has(table)) return this._cache.get(table);
    const data = readJson(this._file(table), fallback);
    this._cache.set(table, data);
    return data;
  }

  save(table) {
    const data = this._cache.get(table);
    if (data === undefined) return;
    atomicWriteJson(this._file(table), data);
  }

  /** returns array of rows for tables stored as objects or arrays */
  allRows(table) {
    const data = this.load(table, table === 'stats' ? [] : {});
    if (Array.isArray(data)) return data;
    return Object.values(data);
  }
}

module.exports = {
  JsonDB,
  DB_DIR
};

const fs = require('fs');
const path = require('path');
const config = require('./config');

const COLLECTIONS = ['cards', 'packs', 'stock', 'reservations'];

function emptyData() {
  return Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
}

function load(file) {
  if (!fs.existsSync(file)) return emptyData();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...emptyData(), ...parsed };
}

const store = {
  data: load(config.data.file),

  // Atomic write (temp file + rename) so a crash cannot leave a half-written file.
  save() {
    if (!config.data.persist) return;
    const tmp = path.join(path.dirname(config.data.file), `.${path.basename(config.data.file)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, config.data.file);
  },

  // Used by tests to start from a known state.
  reset(data = emptyData()) {
    this.data = { ...emptyData(), ...data };
  },

  isReady() {
    return COLLECTIONS.every((name) => Array.isArray(this.data[name]));
  },
};

module.exports = store;

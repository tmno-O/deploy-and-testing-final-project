// Data store แบบ mock: โหลดข้อมูลจากไฟล์ JSON เข้า memory แล้วเขียนกลับไฟล์เมื่อ transaction สำเร็จ
// (ปิดการเขียนไฟล์ได้ด้วย PERSIST_DATA=false). การเขียนทุกครั้งต้องผ่าน transaction() ซึ่งรันทีละอัน (mutex)
// ถ้า callback โยน error ข้อมูลใน memory จะถูกคืนเป็นค่าก่อนเริ่ม และไม่เขียนไฟล์
const fs = require('fs');
const config = require('../config');

const emptyData = () => ({ collections: [], pulls: [], orders: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));

function normalize(parsed) {
  const empty = emptyData();
  for (const key of Object.keys(empty)) {
    if (Array.isArray(parsed[key])) empty[key] = parsed[key];
  }
  return empty;
}

function loadSeed() {
  let raw;
  try {
    raw = fs.readFileSync(config.data.file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyData();
    throw err;
  }
  return normalize(JSON.parse(raw));
}

let data = loadSeed();
let queue = Promise.resolve();

// เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อย rename กันไฟล์พังถ้า process ตายกลางทาง
function save() {
  if (!config.data.persist) return;
  const tmp = `${config.data.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, config.data.file);
}

function transaction(fn) {
  const run = queue.then(async () => {
    const snapshot = clone(data);
    try {
      const result = await fn(data);
      save();
      return result;
    } catch (err) {
      data = snapshot;
      throw err;
    }
  });
  // คิวเดินต่อได้แม้ transaction ก่อนหน้าล้มเหลว
  queue = run.catch(() => {});
  return run;
}

// ใช้ในการทดสอบ: แทนที่ข้อมูลทั้งหมด (ไม่เขียนไฟล์)
function reset(next = emptyData()) {
  data = normalize(clone(next));
}

module.exports = {
  get data() {
    return data;
  },
  transaction,
  reset,
  loadSeed,
  save,
};

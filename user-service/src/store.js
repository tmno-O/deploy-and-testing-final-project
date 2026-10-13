// Data store แบบ mock: โหลดข้อมูลจากไฟล์ JSON เข้า memory แล้วเขียนกลับไฟล์เดิมทุกครั้งที่มีการเปลี่ยนแปลง
// (ปิดการเขียนไฟล์ได้ด้วย PERSIST_DATA=false). Node รันโค้ดแบบ single-thread และ repo ทำงานแบบ synchronous
// จึงไม่ต้องใช้ transaction / lock
const fs = require('fs');
const config = require('./config');

const emptyData = () => ({ users: [], addresses: [] });

function loadSeed() {
  let raw;
  try {
    raw = fs.readFileSync(config.data.file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyData();
    throw err;
  }
  const parsed = JSON.parse(raw);
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
  };
}

let data = loadSeed();

// เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อย rename กันไฟล์พังถ้า process ตายกลางทาง
function save() {
  if (!config.data.persist) return;
  const tmp = `${config.data.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, config.data.file);
}

// ใช้ในการทดสอบ: แทนที่ข้อมูลทั้งหมด (ไม่เขียนไฟล์)
function reset(next = emptyData()) {
  data = JSON.parse(JSON.stringify(next));
}

module.exports = {
  get data() {
    return data;
  },
  save,
  reset,
  loadSeed,
};

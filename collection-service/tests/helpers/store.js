const store = require('../../src/store/jsonStore');

// เริ่มจากข้อมูลว่างทุกครั้ง (test ไม่แตะไฟล์ mock data เพราะ PERSIST_DATA=false)
const resetStore = () => store.reset();

module.exports = { resetStore, store };

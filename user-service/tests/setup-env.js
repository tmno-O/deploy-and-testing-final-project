process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
process.env.PERSIST_DATA = 'false'; // test ห้ามเขียนทับไฟล์ mock data

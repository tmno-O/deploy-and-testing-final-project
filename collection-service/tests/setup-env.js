process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
process.env.SERVICE_API_KEY = process.env.SERVICE_API_KEY || 'test-service-key-test-service-key-123';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key-test-admin-key-12345678';
process.env.USER_SERVICE_URL = 'http://user-service.test';
process.env.CATALOG_SERVICE_URL = '';
process.env.WALLET_ENABLED = 'false';
process.env.PERSIST_DATA = 'false'; // test ห้ามเขียนทับไฟล์ mock data

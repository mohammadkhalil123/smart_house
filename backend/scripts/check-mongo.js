// Read-only connectivity check: node scripts/check-mongo.js   (needs backend/.env)
require('dotenv/config');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE;
if (!uri || !dbName) {
  console.error('Set MONGODB_URI and MONGODB_DATABASE in backend/.env first.');
  process.exit(1);
}
(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    console.log(`Connected. Collections in "${dbName}":`, names.join(', ') || '(none)');
    for (const name of ['Measures', 'Sprinkler']) {
      if (!names.includes(name)) { console.error(`MISSING collection ${name}`); process.exitCode = 2; continue; }
      console.log(`${name}: ${await db.collection(name).countDocuments()} documents`);
    }
  } catch (e) {
    console.error('Connection failed:', String(e.message).replace(/\/\/[^@/]*@/, '//***@'));
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();

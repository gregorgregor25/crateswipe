import { parseArgs } from 'node:util';
import { getDb } from '../db/client.js';
import { applyMigrations } from '../db/migrate.js';
import { hashToken, signToken } from '../middleware/auth.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    admin: { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.name) {
  console.error('Usage: npm run mint-token -- --name "Alice" [--admin]');
  process.exit(1);
}

const db = getDb();
applyMigrations(db);

const now = Date.now();
const insertUser = db.prepare(
  'INSERT INTO users (display_name, is_admin, created_at) VALUES (?, ?, ?)',
);
const result = insertUser.run(values.name, values.admin ? 1 : 0, now);
const userId = Number(result.lastInsertRowid);

const token = signToken({
  userId,
  displayName: values.name,
  isAdmin: Boolean(values.admin),
});

db.prepare(
  'INSERT INTO tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)',
).run(userId, hashToken(token), now);

console.log(`Minted token for user ${values.name} (id=${userId}, admin=${values.admin ? 'yes' : 'no'})`);
console.log('');
console.log(token);
console.log('');
console.log('Add this to the mobile app (Settings → Token) or test with:');
console.log(`  curl -H "Authorization: Bearer ${token}" http://127.0.0.1:3010/crate`);

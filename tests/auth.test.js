const assert = require('assert');
const fs = require('fs');
const seed = JSON.parse(fs.readFileSync(require.resolve('../auth/seed-users.example.json'), 'utf8'));
assert.strictEqual(seed.users.length, 2);
assert.deepStrictEqual(seed.users.map(user => user.username).sort(), ['mat', 'rob']);
assert.deepStrictEqual(seed.users.map(user => user.passwordEnv).sort(), ['RPG_MAT_PASSWORD', 'RPG_ROB_PASSWORD']);

assert.strictEqual(seed.friendships.length, 1);
assert.strictEqual(seed.friendships[0].status, 'accepted');
console.log('auth seed tests passed');

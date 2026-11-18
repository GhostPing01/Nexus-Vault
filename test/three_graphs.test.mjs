import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, dbRun, dbGet, dbAll } from '../server/db.js';
import { syncFileLinks } from '../server/parser.js';

describe('Three Distinct Graph Perspectives Integrity Tests', async () => {
  before(async () => {
    await initDb();
  });

  it('verifies Notes Graph queries are strictly scoped by user_id', async () => {
    const user1 = 'graph_user_1_' + Date.now();
    const user2 = 'graph_user_2_' + Date.now();
    const now = new Date().toISOString();

    // Insert file for User 1
    const title1 = 'Graph Theory Note 1 ' + Date.now();
    const res1 = await dbRun(
      `INSERT INTO files (title, path, content, user_id, note_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title1, `${title1}.md`, '# Graph Theory\n[[Linear Algebra]]', user1, 'raw', now, now]
    );
    await syncFileLinks(res1.lastID, '# Graph Theory\n[[Linear Algebra]]', user1);

    // Insert file for User 2
    const title2 = 'Quantum Note 2 ' + Date.now();
    const res2 = await dbRun(
      `INSERT INTO files (title, path, content, user_id, note_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title2, `${title2}.md`, '# Quantum\n[[Entanglement]]', user2, 'raw', now, now]
    );
    await syncFileLinks(res2.lastID, '# Quantum\n[[Entanglement]]', user2);

    // Query Notes Graph for User 1
    const filesUser1 = await dbAll(`SELECT id, title FROM files WHERE user_id = ?`, [user1]);
    const linksUser1 = await dbAll(`SELECT * FROM links WHERE user_id = ?`, [user1]);

    assert.equal(filesUser1.length, 1);
    assert.equal(filesUser1[0].title, title1);
    assert.equal(linksUser1.length, 1);
    assert.equal(linksUser1[0].target_title, 'Linear Algebra');

    // Query Notes Graph for User 2
    const filesUser2 = await dbAll(`SELECT id, title FROM files WHERE user_id = ?`, [user2]);
    const linksUser2 = await dbAll(`SELECT * FROM links WHERE user_id = ?`, [user2]);

    assert.equal(filesUser2.length, 1);
    assert.equal(filesUser2[0].title, title2);
    assert.equal(linksUser2.length, 1);
    assert.equal(linksUser2[0].target_title, 'Entanglement');
  });
});

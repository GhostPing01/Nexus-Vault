import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, dbRun, dbGet } from '../server/db.js';
import { parseLinks } from '../server/parser.js';
import {
  createConversation,
  createMessage,
  listMessages,
} from '../server/chatService.js';

describe('Knowledge Capture Pipeline & Wiki Links Tests', async () => {
  before(async () => {
    await initDb();
  });

  it('correctly parses plain and contextual wiki links', () => {
    const markdown = `
# Quantum Information
Here we study [[Superposition]] and [[Entanglement | foundation_for | Enables teleportation protocols]].
Also related to [[Matrix Calculus | mathematical_basis | Essential for state vectors]].
    `;

    const links = parseLinks(markdown);
    assert.equal(links.length, 3);

    assert.equal(links[0].target_title, 'Superposition');
    assert.equal(links[0].relationship, null);

    assert.equal(links[1].target_title, 'Entanglement');
    assert.equal(links[1].relationship, 'foundation_for');
    assert.equal(links[1].context, 'Enables teleportation protocols');

    assert.equal(links[2].target_title, 'Matrix Calculus');
    assert.equal(links[2].relationship, 'mathematical_basis');
  });

  it('enforces conversation creation and message isolation per user', async () => {
    const userA = 'user_test_a_' + Date.now();
    const userB = 'user_test_b_' + Date.now();

    const convA = await createConversation(userA, { title: 'User A Neural Nets' });
    assert.ok(convA.id);
    assert.equal(convA.title, 'User A Neural Nets');

    const msgA = await createMessage(userA, convA.id, {
      role: 'user',
      content: 'Explain gradient descent in deep learning',
    });
    assert.ok(msgA.id);

    // Verify User A can list their messages
    const messagesA = await listMessages(userA, convA.id);
    assert.equal(messagesA.length, 1);
    assert.equal(messagesA[0].content, 'Explain gradient descent in deep learning');

    // Verify User B cannot access User A's conversation
    await assert.rejects(
      async () => {
        await listMessages(userB, convA.id);
      },
      /Conversation not found/i,
      'User B must receive 404 when accessing User A conversation'
    );
  });
});

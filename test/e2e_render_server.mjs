import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

console.log('--- Starting Nexus Vault Production Server for E2E Verification ---');
const serverProc = spawn('node', ['server/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(TEST_PORT),
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProc.stdout.on('data', (d) => process.stdout.write(`[SERVER STDOUT] ${d}`));
serverProc.stderr.on('data', (d) => process.stderr.write(`[SERVER STDERR] ${d}`));

async function waitServerReady(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Server did not become ready in time');
}

async function runE2E() {
  try {
    await waitServerReady();
    console.log('Server is healthy and ready!');

    // 1. Health check verification
    console.log('Test 1: Health Check Endpoint');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.service, 'nexus-vault');
    console.log('✔ Health check verified!');

    // 2. Static HTML SPA serving verification
    console.log('Test 2: Production SPA Static File Serving');
    const htmlRes = await fetch(`${BASE_URL}/`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('<div id="root">'), 'index.html must be served at root URL');
    assert.ok(htmlText.includes('Newsreader'), 'Newsreader font must be preserved in HTML');
    console.log('✔ Production static SPA serving verified!');

    // 3. Seeded files listing
    console.log('Test 3: Seeded Files Listing');
    const filesRes = await fetch(`${BASE_URL}/api/files`);
    assert.equal(filesRes.status, 200);
    const files = await filesRes.json();
    assert.ok(Array.isArray(files));
    assert.ok(files.length > 0, 'Database must be seeded with initial files');
    console.log(`✔ Found ${files.length} seeded vault notes!`);

    // 4. Notes Graph verification
    console.log('Test 4: Notes Graph Query');
    const graphRes = await fetch(`${BASE_URL}/api/graph`);
    assert.equal(graphRes.status, 200);
    const graph = await graphRes.json();
    assert.ok(Array.isArray(graph.nodes));
    assert.ok(Array.isArray(graph.links));
    console.log(`✔ Notes graph contains ${graph.nodes.length} nodes and ${graph.links.length} links!`);

    // 5. Auth registration and login
    console.log('Test 5: User Registration & Session Token Flow');
    const testEmail = `e2e_${Date.now()}@render.test`;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123#Secure',
        name: 'E2E Tester',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.token);
    assert.equal(regData.user.email, testEmail);
    const userToken = regData.token;
    console.log('✔ User registered successfully with token!');

    // 6. Authenticated /api/auth/me check
    console.log('Test 6: Authenticated Session Validation (/api/auth/me)');
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.ok(meData.user);
    assert.equal(meData.user.email, testEmail);
    console.log('✔ Authenticated session confirmed!');

    // 7. ChattyFi Conversation Creation
    console.log('Test 7: ChattyFi Conversation Creation');
    const convRes = await fetch(`${BASE_URL}/api/chattyfi/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        title: 'Deep Learning & Spectral Theory',
      }),
    });
    assert.equal(convRes.status, 201);
    const conv = await convRes.json();
    assert.ok(conv.id);
    console.log(`✔ Created conversation ${conv.id}!`);

    // 8. ChattyFi Reply Generation (verifying NO HANGING defect)
    console.log('Test 8: ChattyFi Assistant Reply Pipeline (Defect 1 Verification)');
    const replyRes = await fetch(`${BASE_URL}/api/chattyfi/conversations/${conv.id}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        prompt: 'What is the relation between the graph Laplacian and Cheeger conductance?',
      }),
    });
    assert.equal(replyRes.status, 201, 'Reply generation must return 201 without hanging');
    const replyData = await replyRes.json();
    assert.ok(replyData.message);
    assert.ok(replyData.message.content.length > 20);
    console.log(`✔ Reply generated successfully! Content length: ${replyData.message.content.length} chars.`);

    // 9. ChattyFi Knowledge Capture Pipeline
    console.log('Test 9: Knowledge Capture Pipeline (ChattyFi -> Vault Note)');
    const captureRes = await fetch(`${BASE_URL}/api/chattyfi/conversations/${conv.id}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        messageId: replyData.message.id,
        format: 'raw',
        preferredTitle: 'Cheeger Conductance & Laplacian Insights',
      }),
    });
    assert.equal(captureRes.status, 201);
    const captureData = await captureRes.json();
    assert.ok(captureData.file);
    assert.equal(captureData.file.title, 'Cheeger Conductance & Laplacian Insights');
    console.log(`✔ Captured note created with ID ${captureData.file.id}!`);

    // 10. Security: Verify User Isolation
    console.log('Test 10: Strict User Isolation (IDOR Prevention)');
    const unauthedRes = await fetch(`${BASE_URL}/api/chattyfi/conversations/${conv.id}/messages`);
    // Guest/unauthenticated user accessing private user's conversation must fail with 404
    assert.equal(unauthedRes.status, 404, 'Guest must not access registered user conversation');
    console.log('✔ Cross-user access securely blocked with 404!');

    console.log('\n========================================');
    console.log('ALL 10 E2E PRODUCTION VERIFICATIONS PASSED!');
    console.log('========================================\n');
  } finally {
    serverProc.kill();
  }
}

runE2E().catch((err) => {
  console.error('E2E TEST FAILURE:', err);
  serverProc.kill();
  process.exit(1);
});

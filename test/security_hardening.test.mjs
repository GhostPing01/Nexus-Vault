import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { sanitizeFileName } from '../server/diskSync.js';
import { validateSafeUrl } from '../server/universalAi.js';

describe('Security Hardening & Safeguards Tests', () => {
  it('sanitizes file names to prevent directory traversal and illegal Windows characters', () => {
    assert.equal(sanitizeFileName('../../evil.md'), '.. - .. - evil.md');
    assert.equal(sanitizeFileName('con:aux*?.txt'), 'con - aux - - .txt');
    assert.equal(sanitizeFileName('Clean Note Title'), 'Clean Note Title');
    assert.equal(sanitizeFileName(''), 'Untitled');
  });

  it('validates URLs and blocks Cloud Metadata service SSRF attempts', () => {
    assert.throws(
      () => validateSafeUrl('http://169.254.169.254/latest/meta-data/'),
      /blocked/i,
      'Must block AWS/GCP metadata IP'
    );

    assert.throws(
      () => validateSafeUrl('http://metadata.google.internal/computeMetadata/v1/'),
      /blocked/i,
      'Must block Google cloud metadata internal hostname'
    );

    assert.throws(
      () => validateSafeUrl('file:///etc/passwd'),
      /Only http: and https:/i,
      'Must block non-HTTP protocols'
    );

    assert.throws(
      () => validateSafeUrl('javascript:alert(1)'),
      /Only http: and https:/i,
      'Must block javascript pseudoprotocol'
    );

    // Legitimate public API endpoints must pass
    const valid = validateSafeUrl('https://api.groq.com/openai/v1/chat/completions');
    assert.equal(valid, 'https://api.groq.com/openai/v1/chat/completions');
  });

  it('blocks private/local IPs in production mode', () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => validateSafeUrl('http://localhost:8080/internal'),
        /blocked in production/i,
        'Must block localhost in production'
      );
      assert.throws(
        () => validateSafeUrl('http://127.0.0.1:3000'),
        /blocked in production/i,
        'Must block loopback in production'
      );
      assert.throws(
        () => validateSafeUrl('http://10.0.0.5/admin'),
        /blocked in production/i,
        'Must block 10.0.0.0/8 private network in production'
      );
      assert.throws(
        () => validateSafeUrl('http://192.168.1.1/router'),
        /blocked in production/i,
        'Must block 192.168.0.0/16 private network in production'
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

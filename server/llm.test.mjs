// Targeted tests for the BYOK encryption layer added in server/llm.js.
// Verifies that:
//   1. seal + open round-trips an API key
//   2. tampering with the ciphertext fails the GCM auth tag
//   3. each call produces a fresh random IV
//   4. the provider allow-list rejects unknown providers
//
// Runs without a database: we only exercise the pure-crypto exports.

import assert from 'node:assert/strict'

// Provide an env secret so the module initialises its derived key.
process.env.LLM_KEY_SECRET = 'test-secret-do-not-use-in-prod'

const { seal, open, isValidProvider, PROVIDERS } = await import('./llm.js')

const sample = 'sk-test-1234567890abcdef'

// 1. round-trip
{
  const sealed = seal(sample)
  assert.ok(Buffer.isBuffer(sealed.iv), 'iv should be a Buffer')
  assert.equal(sealed.iv.length, 12, 'GCM iv should be 12 bytes')
  assert.ok(Buffer.isBuffer(sealed.ciphertext), 'ciphertext should be a Buffer')
  // ciphertext includes the 16-byte auth tag
  assert.ok(sealed.ciphertext.length >= sample.length + 16)
  const recovered = open(sealed)
  assert.equal(recovered, sample, 'round-trip should recover the plaintext')
}

// 2. tamper detection
{
  const sealed = seal(sample)
  const tampered = Buffer.from(sealed.ciphertext)
  tampered[0] ^= 0xff
  assert.throws(
    () => open({ iv: sealed.iv, ciphertext: tampered }),
    /unable to authenticate data|auth/i,
    'tampered ciphertext should fail GCM authentication'
  )
}

// 3. fresh IV per call (random nonce — astronomically unlikely to collide)
{
  const a = seal(sample)
  const b = seal(sample)
  assert.notEqual(a.iv.toString('hex'), b.iv.toString('hex'), 'IVs must differ across calls')
  assert.notEqual(a.ciphertext.toString('hex'), b.ciphertext.toString('hex'), 'ciphertext must differ across calls')
}

// 4. provider allow-list
{
  assert.equal(isValidProvider('openai'), true)
  assert.equal(isValidProvider('anthropic'), true)
  assert.equal(isValidProvider('groq'), true)
  assert.equal(isValidProvider('openrouter'), true)
  assert.equal(isValidProvider('hostile.example.com'), false)
  assert.equal(isValidProvider(''), false)
  assert.equal(isValidProvider(null), false)
  assert.equal(isValidProvider({ toString: () => 'openai' }), false, 'non-strings must be rejected')
  // Every advertised provider must have a default model and an HTTPS endpoint.
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.ok(p.defaultModel, `${id} missing defaultModel`)
    assert.ok(p.endpoint?.startsWith('https://'), `${id} endpoint must be HTTPS`)
  }
}

console.log('llm: all tests passed')

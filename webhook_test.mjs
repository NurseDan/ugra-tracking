import { validateWebhookUrl, dispatchWebhook } from '/Users/dwiglesworth/Library/Mobile Documents/com~apple~CloudDocs/Apps/ugra/ugra/server/webhooks.js'

async function runTests() {
  let passed = 0
  let failed = 0

  async function expectSuccess(url) {
    try {
      await validateWebhookUrl(url)
      passed++
      console.log(`✅ [PASS] Success as expected: ${url}`)
    } catch (e) {
      failed++
      console.error(`❌ [FAIL] Expected success for ${url}, but got error: ${e.message}`)
    }
  }

  async function expectFail(url, expectedMsgFragment) {
    try {
      await validateWebhookUrl(url)
      failed++
      console.error(`❌ [FAIL] Expected failure for ${url}, but it succeeded!`)
    } catch (e) {
      if (!expectedMsgFragment || e.message.includes(expectedMsgFragment)) {
        passed++
        console.log(`✅ [PASS] Failed as expected: ${url} (${e.message})`)
      } else {
        failed++
        console.error(`❌ [FAIL] Expected failure containing "${expectedMsgFragment}" for ${url}, but got: ${e.message}`)
      }
    }
  }

  console.log("--- Running Webhook Validation Tests ---")
  
  await expectSuccess('https://example.com/webhook')
  await expectSuccess('http://example.org/api/receive')
  
  await expectFail('ftp://example.com', 'must use http or https')
  await expectFail('https://localhost/webhook', 'Webhook host not allowed')
  await expectFail('http://127.0.0.1/webhook', 'resolves to a private/internal address')
  await expectFail('http://169.254.169.254/latest/meta-data', 'resolves to a private/internal address')
  await expectFail('http://10.0.0.1/webhook', 'resolves to a private/internal address')
  await expectFail('http://[::1]/webhook', 'resolves to a private/internal address')

  console.log(`\nResults: ${passed} passed, ${failed} failed.`)
}

runTests().catch(console.error)

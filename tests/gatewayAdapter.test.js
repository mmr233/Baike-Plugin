import test from 'node:test'
import assert from 'node:assert/strict'
import Config from '../model/Config.js'
import ApiService from '../model/services/apiService.js'

test('Baike sends gateway credentials without mixing them or local keys into the model source', async () => {
  const originalGet = Config.get
  const originalGateway = globalThis.LLMGateway
  const originalLogger = globalThis.logger
  let request = null

  Config.get = (path, fallback) => {
    const values = {
      'api.gateway': {
        enabled: true,
        fallbackToLocal: false,
        clientId: 'baike-plugin',
        accessCode: 'baike-access-code'
      },
      'api.summary': {
        model: 'summary-model',
        apiPresetId: 'shared',
        apiKeyGroupId: 'primary',
        requestMode: 'response',
        timeoutMs: 120000,
        connectTimeoutMs: 30000,
        retryCount: 1,
        fallbackModels: []
      },
      'runtime.debug': false
    }
    return Object.prototype.hasOwnProperty.call(values, path) ? values[path] : fallback
  }
  globalThis.logger = { info() {}, warn() {}, error() {} }
  globalThis.LLMGateway = {
    async chat(options) {
      request = options
      return {
        requestId: 'gateway-request',
        caller: 'baike-plugin',
        purpose: 'summary',
        text: 'ok',
        json: { choices: [{ message: { content: 'ok' } }] },
        candidate: { model: 'summary-model' }
      }
    }
  }

  try {
    const service = new ApiService()
    const result = await service.requestChatCompletionViaGateway(
      'summary',
      [{ role: 'user', content: 'hello' }],
      {
        baseUrl: 'https://local.example/v1',
        apiKey: 'local-api-key',
        endpointType: 'openai-chat'
      }
    )

    assert.equal(result.text, 'ok')
    assert.equal(request.clientId, 'baike-plugin')
    assert.equal(request.accessCode, 'baike-access-code')
    assert.deepEqual(request.source, {
      model: 'summary-model',
      apiPresetId: 'shared',
      apiKeyGroupId: 'primary',
      requestMode: 'response'
    })
    assert.equal(JSON.stringify(request.source).includes('accessCode'), false)
    assert.equal(JSON.stringify(request).includes('local-api-key'), false)
    assert.equal(JSON.stringify(request).includes('https://local.example'), false)
  } finally {
    Config.get = originalGet
    globalThis.LLMGateway = originalGateway
    globalThis.logger = originalLogger
  }
})

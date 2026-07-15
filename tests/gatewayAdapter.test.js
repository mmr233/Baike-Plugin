import test from 'node:test'
import assert from 'node:assert/strict'
import Config from '../model/Config.js'
import { getConfigData } from '../model/guoba/getConfigData.js'
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
        pluginName: 'Baike-Plugin',
        accessCode: 'gateway-access-code'
      },
      'api.summary': {
        model: 'summary-model',
        apiPresetId: 'gateway:shared',
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
    assert.equal(service.shouldUseGatewayForModel('summary'), true)
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
    assert.equal(request.pluginName, 'Baike-Plugin')
    assert.equal(request.accessCode, 'gateway-access-code')
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

test('enabling the gateway appends gateway sources without replacing local model options', async () => {
  const originalGetAll = Config.getAll
  const originalGateway = globalThis.LLMGateway
  let currentConfig = {
    api: {
      gateway: {
        enabled: true,
        fallbackToLocal: true,
        pluginName: 'Baike-Plugin',
        accessCode: 'gateway-access-code'
      },
      presets: [{
        id: 'local',
        name: 'Local API',
        baseUrl: 'https://local.example/v1',
        endpointType: 'openai-chat',
        keyGroups: [{ id: 'main', name: 'Local Key', apiKey: 'local-key' }]
      }],
      modelOptionsCache: {
        sources: [{
          apiPresetId: 'local',
          apiKeyGroupId: 'main',
          endpointType: 'openai-chat',
          updatedAt: 1,
          models: ['local-model']
        }]
      },
      summary: {
        model: 'local-model',
        apiPresetId: 'local',
        apiKeyGroupId: 'main'
      }
    }
  }
  Config.getAll = () => structuredClone(currentConfig)
  globalThis.LLMGateway = {
    async chat() {},
    getPresets() {
      return [{ id: 'remote', name: 'Remote API' }]
    },
    getSelectionData() {
      return {
        presetOptions: [{ label: 'Remote API', value: 'remote' }],
        keyGroupOptions: [{
          label: 'Remote API / Remote Key',
          value: 'remote::main',
          presetId: 'remote',
          keyGroupId: 'main'
        }],
        keyGroupOptionsByPreset: {
          remote: [{ label: 'Remote Key', value: 'main', presetId: 'remote', keyGroupId: 'main' }]
        },
        defaultKeyGroupByPreset: { remote: 'main' },
        modelOptions: [{ label: 'remote-model', value: 'remote-model' }],
        modelOptionsBySource: {
          'remote::main': [{ label: 'remote-model', value: 'remote-model' }]
        }
      }
    }
  }

  try {
    const service = new ApiService()
    assert.equal(service.shouldUseGatewayForModel('summary'), false)
    const localForm = await getConfigData()
    const localSummary = localForm._apiSummaryConfig[0]
    assert.ok(localSummary.__apiPresetOptions.some(item => item.value === 'local'))
    assert.ok(localSummary.__apiPresetOptions.some(item => item.value === 'gateway:remote'))
    assert.ok(localSummary.__modelOptions.some(item => item.value === 'local-model'))
    assert.ok(localSummary.__modelOptionsMap['local::main'])
    assert.ok(localSummary.__modelOptionsMap['gateway:remote::main'])

    currentConfig.api.summary = {
      model: 'remote-model',
      apiPresetId: 'remote',
      apiKeyGroupId: 'main',
      fallbackModels: [{
        model: 'local-model',
        apiPresetId: 'local',
        apiKeyGroupId: 'main'
      }]
    }
    assert.equal(service.shouldUseGatewayForModel('summary'), true)
    const mixedCandidates = service.getModelConfigCandidates('summary')
    assert.equal(mixedCandidates[0].gatewayCandidate, true)
    assert.equal(mixedCandidates[0].valid, false)
    assert.equal(mixedCandidates[1].valid, true)
    const gatewayForm = await getConfigData()
    const gatewaySummary = gatewayForm._apiSummaryConfig[0]
    assert.ok(gatewaySummary.__modelOptions.some(item => item.value === 'remote-model'))
    assert.equal(gatewaySummary.apiPresetId, 'gateway:remote')
  } finally {
    Config.getAll = originalGetAll
    globalThis.LLMGateway = originalGateway
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import Config from '../model/Config.js'
import { getConfigData } from '../model/guoba/getConfigData.js'

test('Guoba config excludes retired model gateway settings', async () => {
  const originalGetAll = Config.getAll
  Config.getAll = () => ({
    api: {
      gateway: {
        enabled: true,
        accessCode: 'legacy-code'
      },
      presets: [{
        id: 'local',
        name: 'Local API',
        baseUrl: 'https://local.example/v1',
        endpointType: 'openai-chat',
        keyGroups: [{ id: 'main', name: 'Main Key', apiKey: 'local-key' }]
      }],
      modelOptionsCache: {
        sources: [{
          apiPresetId: 'local',
          apiKeyGroupId: 'main',
          endpointType: 'openai-chat',
          models: ['local-model']
        }]
      },
      summary: {
        model: 'local-model',
        apiPresetId: 'local',
        apiKeyGroupId: 'main'
      }
    }
  })

  try {
    const config = await getConfigData()
    assert.equal(config.api.gateway, undefined)
    assert.deepEqual(
      config._apiSummaryConfig[0].__apiPresetOptions.map(item => item.value),
      ['', 'local']
    )
    assert.ok(config._apiSummaryConfig[0].__modelOptions.some(item => item.value === 'local-model'))
  } finally {
    Config.getAll = originalGetAll
  }
})

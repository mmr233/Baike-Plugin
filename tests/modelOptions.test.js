import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModelOptionsMapFromCache } from '../model/guoba/modelOptions.js'

test('model option map keeps only keys used by the Guoba form bindings', () => {
  const models = Array.from({ length: 400 }, (_, index) => `provider-model-${index + 1}`)
  const map = buildModelOptionsMapFromCache([{
    apiPresetId: 'local',
    apiKeyGroupId: 'main',
    baseUrl: 'https://local.example/v1',
    endpointType: 'openai-chat',
    models
  }])

  assert.deepEqual(Object.keys(map).sort(), [
    'base:https://local.example/v1',
    'base:https://local.example/v1::inherit',
    'base:https://local.example/v1::openai-chat',
    'local::main',
    'local::main::inherit',
    'local::main::openai-chat'
  ])
  assert.equal(map['local::main'].length, 120)
  assert.equal(map['local::local::main'], undefined)
  assert.equal(map['::::openai-chat'], undefined)
})

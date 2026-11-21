import assert from 'node:assert/strict'
import test from 'node:test'
import Config from '../model/Config.js'
import ApiService from '../model/services/apiService.js'

globalThis.logger = globalThis.logger || { info() {}, warn() {}, error() {} }

async function summarizeResponse(json) {
  const service = new ApiService()
  service.requestChatCompletion = async () => ({
    json,
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 }
  })
  return service.callSummaryTextAPI('input', null, { beautify: false, returnMeta: true })
}

async function readEvents(events) {
  const service = new ApiService()
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  return service.readStreamedChatCompletion(response, 'summary')
}

const responseCases = [
  {
    name: 'OpenAI Chat Completions',
    json: { choices: [{ message: { reasoning_content: 'private thinking', content: '<think>private reasoning</think>final answer' } }] }
  },
  {
    name: 'OpenAI Responses',
    json: { output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'private reasoning' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'final answer' }] }
    ] }
  },
  {
    name: 'Anthropic Messages',
    json: { content: [
      { type: 'thinking', thinking: 'private thinking', text: 'private reasoning' },
      { type: 'redacted_thinking', data: 'private data' },
      { type: 'text', text: 'final answer' }
    ] }
  },
  {
    name: 'Gemini Native',
    json: { candidates: [{ content: { parts: [
      { thought: true, text: 'private reasoning' },
      { text: 'final answer' }
    ] } }] }
  }
]

for (const { name, json } of responseCases) {
  test(`${name} non-stream response excludes reasoning from the summary`, async () => {
    const result = await summarizeResponse(json)
    assert.equal(result.text, 'final answer')
    assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 })
  })
}

const streamCases = [
  {
    name: 'OpenAI Chat Completions',
    events: [
      { choices: [{ delta: { reasoning_content: 'private reasoning' } }] },
      { choices: [{ delta: { content: '<thi' } }] },
      { choices: [{ delta: { content: 'nk>private reasoning</think>final ' } }] },
      { choices: [{ delta: { content: 'answer' } }] }
    ]
  },
  {
    name: 'OpenAI Responses',
    events: [
      { type: 'response.reasoning_summary_text.delta', delta: 'private reasoning' },
      { type: 'response.output_item.done', output: [{ type: 'reasoning', content: 'private reasoning' }] },
      { type: 'response.output_text.delta', delta: 'final ' },
      { type: 'response.output_text.delta', delta: 'answer' }
    ]
  },
  {
    name: 'Anthropic Messages',
    events: [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'private thinking', text: 'private reasoning' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'final ' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } }
    ]
  },
  {
    name: 'Gemini Native',
    events: [
      { candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }, { text: 'final ' }] } }] },
      { candidates: [{ content: { parts: [{ thought: true, text: 'private thinking' }, { text: 'answer' }] } }] }
    ]
  }
]

for (const { name, events } of streamCases) {
  test(`${name} stream excludes reasoning from the summary`, async () => {
    const streamed = await readEvents([...events, { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }])
    assert.equal(streamed.text, 'final answer')
    assert.deepEqual(streamed.json.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 })
    const result = await summarizeResponse(streamed.json)
    assert.equal(result.text, 'final answer')
  })
}

test('a reasoning-only response does not become a summary', async () => {
  assert.equal(await summarizeResponse({ choices: [{ message: { content: '<think>private reasoning' } }] }), null)
  assert.equal(await summarizeResponse({ type: 'thinking', content: 'private reasoning' }), null)
  const streamed = await readEvents([
    { candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }] } }] }
  ])
  assert.equal(streamed.text, '')
  assert.equal(await summarizeResponse(streamed.json), null)
})

test('reasoning tags and reasoning blocks do not remove normal content', async () => {
  const result = await summarizeResponse({ choices: [{ message: { content: [
    { type: 'reasoning', text: 'private reasoning' },
    { type: 'text', text: '<analysis>private analysis</analysis>first' },
    { type: 'text', text: '<thinking>private thinking</thinking>second' }
  ] } }] })

  assert.equal(result.text, 'first\nsecond')
})

test('Responses stream can recover the final snapshot and citations', async () => {
  const streamed = await readEvents([
    { type: 'response.reasoning_summary_text.delta', delta: 'private reasoning' },
    { type: 'response.output_text.annotation.added', annotation: { url: 'https://source.example/article' } },
    { type: 'response.completed', response: { output: [
      { type: 'reasoning', content: 'https://private.example/reasoning' },
      { type: 'message', content: [{ type: 'output_text', text: 'final answer' }] }
    ], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } }
  ])

  assert.equal(streamed.text, 'final answer')
  assert.deepEqual(streamed.json.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 })
  assert.deepEqual(streamed.json.choices[0].message.citations, ['https://source.example/article'])
})

test('reasoning sources do not appear among search citations', async () => {
  const service = new ApiService()
  service.requestChatCompletion = async () => ({ json: { output: [
    { type: 'reasoning', content: 'https://private.example/reasoning' },
    { type: 'message', content: [{ type: 'output_text', text: 'final answer', annotations: [{ url: 'https://source.example/article' }] }] }
  ] } })

  const result = await service.searchKeyword('query')
  assert.equal(result.content, 'final answer')
  assert.deepEqual(result.citations, ['https://source.example/article'])
})

test('request pipeline logs and returns only the final answer', async () => {
  const service = new ApiService()
  const originalFetch = globalThis.fetch
  const originalLogger = globalThis.logger
  const originalGet = Config.get
  const logs = []
  service.getModelConfigCandidates = () => [{
    valid: true,
    label: 'test',
    source: 'primary',
    model: 'test-model',
    baseUrl: 'https://provider.example/v1',
    apiKey: 'test-key',
    endpointType: 'gemini-native',
    requestMode: 'response',
    timeoutMs: 5000,
    connectTimeoutMs: 5000,
    retryCount: 0
  }]
  service.getFetchDispatcher = async () => null
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [
      { thought: true, text: 'private reasoning' },
      { text: 'final answer' }
    ] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
  }), { headers: { 'content-type': 'application/json' } })
  globalThis.logger = { info(message) { logs.push(message) }, warn() {}, error() {} }
  Config.get = (key, fallback) => key === 'debug.enabled' ? true : originalGet.call(Config, key, fallback)

  try {
    const result = await service.callSummaryTextAPI('input', null, { beautify: false, returnMeta: true })
    assert.equal(result.text, 'final answer')
    assert.equal(result.usage.totalTokens, 20)
    assert.ok(logs.some(message => message.includes('final answer')))
    assert.ok(logs.every(message => !message.includes('private reasoning')))
  } finally {
    globalThis.fetch = originalFetch
    globalThis.logger = originalLogger
    Config.get = originalGet
  }
})

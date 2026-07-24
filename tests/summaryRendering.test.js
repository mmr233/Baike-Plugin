import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.logger = globalThis.logger || {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

const [{ default: baikeService }, { default: MediaService }, { generateGroupSummaryHTML }, { default: Config }] = await Promise.all([
  import('../model/services/baikeService.js'),
  import('../model/services/mediaService.js'),
  import('../utils/html.js'),
  import('../model/Config.js')
])

async function withMockedStructuredSummaryConfig(callback) {
  const originalGet = Config.get
  const promptMap = {
    'prompt.groupContentAnalysis': 'CONTENT\n{messageTexts}',
    'prompt.groupPeopleAnalysis': 'PEOPLE\n{messageTexts}',
    'prompt.groupTopics': 'TOPICS\n{messageTexts}',
    'prompt.groupTopicSummary': 'TOPIC_SUMMARY\n{messageTexts}',
    'prompt.groupHighlights': 'HIGHLIGHTS\n{messageTexts}',
    'prompt.groupUserPortraits': 'PORTRAITS\n{messageTexts}',
    'prompt.groupQualityReview': 'QUALITY\n{messageTexts}'
  }
  Config.get = (path, fallback) => {
    if (path === 'chatSummary.structuredAnalysis') {
      return {
        maxConcurrent: 2,
        schemaRepairRetries: 0,
        maxTopics: 4,
        maxHighlights: 5
      }
    }
    return promptMap[path] ?? fallback
  }

  try {
    await callback()
  } finally {
    Config.get = originalGet
  }
}

test('card rendering does not wait for global network idle', async () => {
  const service = new MediaService()
  const calls = {
    evaluate: [],
    setContent: null,
    screenshot: null,
    closed: false
  }
  const page = {
    async setViewport() {},
    async setContent(_html, options) {
      calls.setContent = options
    },
    async evaluate(_callback, ...args) {
      calls.evaluate.push(args)
      return calls.evaluate.length === 1
        ? { imageCount: 1, unavailableImageCount: 1 }
        : { width: 760, height: 480 }
    },
    async screenshot(options) {
      calls.screenshot = options
    }
  }
  service.launchBrowser = async () => ({
    async newPage() {
      return page
    },
    async close() {
      calls.closed = true
    }
  })

  const result = await service.renderHtmlToImage('<html><body><div class="journal">card</div></body></html>')

  assert.ok(result.endsWith('.png'))
  assert.deepEqual(calls.setContent, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  })
  assert.deepEqual(calls.evaluate[0], [8000])
  assert.ok(calls.screenshot)
  assert.equal(calls.closed, true)
})

test('download resource labels omit signed query parameters', () => {
  const service = new MediaService()
  const label = service.getSafeResourceLabel(
    'https://example.com/media/image.png?token=secret',
    'image.png'
  )

  assert.equal(label, 'image.png <- example.com/media/image.png')
})

test('highlight identity keeps the matched QQ, nickname and avatar together', () => {
  const parsed = {
    highlights: [{
      sender: 'Alice',
      content: '这条内容来自 Bob',
      time: '20:00'
    }]
  }
  const messages = [{
    user_id: '10001',
    nickname: 'Alice',
    text: '另一条消息',
    time: '20:00'
  }, {
    user_id: '10002',
    nickname: 'Bob',
    text: '这条内容来自 Bob',
    time: '20:01'
  }]

  const result = baikeService.enrichGroupSummaryParsed(parsed, messages)

  assert.equal(result.highlights[0].userId, '10002')
  assert.equal(result.highlights[0].sender, 'Bob')
  assert.match(result.highlights[0].avatar, /nk=10002$/)
})

test('highlight user ID prevents matching another user with identical content', () => {
  const parsed = {
    highlights: [{
      userId: '10001',
      sender: 'Alice',
      content: '相同内容'
    }]
  }
  const messages = [{
    user_id: '10002',
    nickname: 'Bob',
    text: '相同内容'
  }, {
    user_id: '10001',
    nickname: 'Alice',
    text: '相同内容'
  }]

  const result = baikeService.enrichGroupSummaryParsed(parsed, messages)

  assert.equal(result.highlights[0].userId, '10001')
  assert.equal(result.highlights[0].sender, 'Alice')
  assert.match(result.highlights[0].avatar, /nk=10001$/)
})

test('highlight message index resolves the original message directly', () => {
  const parsed = {
    highlights: [{
      messageIndex: 2,
      sender: '错误昵称',
      content: '被模型改写的内容'
    }]
  }
  const messages = [{
    user_id: '10001',
    nickname: 'Alice',
    text: '第一条'
  }, {
    user_id: '10002',
    nickname: 'Bob',
    text: '第二条真实消息'
  }]

  const result = baikeService.enrichGroupSummaryParsed(parsed, messages)

  assert.equal(result.highlights[0].userId, '10002')
  assert.equal(result.highlights[0].sender, 'Bob')
})

test('structured group summary uses two requests when both domains are complete', async () => {
  await withMockedStructuredSummaryConfig(async () => {
    const originalCall = baikeService.apiService.callSummaryTextAPI
    const prompts = []
    baikeService.apiService.callSummaryTextAPI = async prompt => {
      prompts.push(prompt)
      if (prompt.startsWith('CONTENT')) {
        return {
          text: JSON.stringify({
            topics: [{ topic: '接口优化', contributors: ['Alice'], detail: '讨论减少重复请求' }],
            topicSummary: '大家集中讨论了总结接口的优化方案。',
            highlights: [{ message_index: 1, sender: 'Alice', content: '减少重复请求', roast: '终于开始给 Token 减负。' }]
          })
        }
      }
      return {
        text: JSON.stringify({
          userPortraits: [{ name: 'Alice', user_id: '10001', title: '优化派', keywords: ['接口优化'], summary: '关注请求成本。' }],
          qualityReview: { title: '优化现场', subtitle: '少请求，多结果', dimensions: [], summary: '讨论目标明确。' }
        })
      }
    }

    try {
      const result = await baikeService.runStructuredGroupSummary({
        formattedMessages: [{ user_id: '10001', nickname: 'Alice', text: '减少重复请求' }],
        sortedMembers: [['Alice', 1]],
        statsText: 'Alice: 1条'
      })

      assert.equal(prompts.length, 2)
      assert.equal(result.parsed.topicSummary, '大家集中讨论了总结接口的优化方案。')
      assert.equal(result.parsed.highlights[0].messageIndex, 1)
      assert.equal(result.parsed.userPortraits[0].nickname, 'Alice')
    } finally {
      baikeService.apiService.callSummaryTextAPI = originalCall
    }
  })
})

test('structured group summary repairs only a missing field', async () => {
  await withMockedStructuredSummaryConfig(async () => {
    const originalCall = baikeService.apiService.callSummaryTextAPI
    const prompts = []
    baikeService.apiService.callSummaryTextAPI = async prompt => {
      prompts.push(prompt)
      if (prompt.startsWith('CONTENT')) {
        return { text: JSON.stringify({ topics: [], topicSummary: '已有总结' }) }
      }
      if (prompt.startsWith('PEOPLE')) {
        return { text: JSON.stringify({ userPortraits: [], qualityReview: null }) }
      }
      if (prompt.startsWith('HIGHLIGHTS')) {
        return { text: JSON.stringify([{ message_index: 1, sender: 'Alice', content: '局部补修成功' }]) }
      }
      throw new Error(`unexpected prompt: ${prompt}`)
    }

    try {
      const result = await baikeService.runStructuredGroupSummary({
        formattedMessages: [{ user_id: '10001', nickname: 'Alice', text: '局部补修成功' }],
        sortedMembers: [['Alice', 1]],
        statsText: 'Alice: 1条'
      })

      assert.equal(prompts.length, 3)
      assert.equal(prompts.filter(prompt => prompt.startsWith('HIGHLIGHTS')).length, 1)
      assert.equal(result.parsed.highlights[0].content, '局部补修成功')
    } finally {
      baikeService.apiService.callSummaryTextAPI = originalCall
    }
  })
})

test('JSON syntax repair does not resend the original chat prompt', async () => {
  const originalCall = baikeService.apiService.callSummaryTextAPI
  const prompts = []
  baikeService.apiService.callSummaryTextAPI = async prompt => {
    prompts.push(prompt)
    return prompts.length === 1
      ? { text: '{"topics": [' }
      : { text: '{"topics": []}' }
  }

  try {
    const result = await baikeService.callEnhancedJsonModule('内容分析', 'ORIGINAL_CHAT_SENTINEL', {
      repairRetries: 1
    })

    assert.deepEqual(result.value, { topics: [] })
    assert.equal(prompts.length, 2)
    assert.equal(prompts[1].includes('ORIGINAL_CHAT_SENTINEL'), false)
  } finally {
    baikeService.apiService.callSummaryTextAPI = originalCall
  }
})

test('identity enhancement switch prevents loading Iris identities', async () => {
  const originalGet = Config.get
  const originalIdentityLookup = baikeService.identityService.getUserIdentities
  let lookupCount = 0
  Config.get = (path, fallback) => path === 'chatSummary.identityEnhancement.enabled' ? false : fallback
  baikeService.identityService.getUserIdentities = async () => {
    lookupCount += 1
    return { 10001: { isMaster: true } }
  }

  try {
    const result = await baikeService.getSummaryIdentityProfiles([{ user_id: '10001' }], {})
    assert.deepEqual(result, {})
    assert.equal(lookupCount, 0)
  } finally {
    Config.get = originalGet
    baikeService.identityService.getUserIdentities = originalIdentityLookup
  }
})

test('identity enhancement failure never interrupts the summary flow', async () => {
  const originalGet = Config.get
  const originalIdentityLookup = baikeService.identityService.getUserIdentities
  Config.get = (path, fallback) => path === 'chatSummary.identityEnhancement.enabled' ? true : fallback
  baikeService.identityService.getUserIdentities = async () => {
    throw new Error('Iris unavailable')
  }

  try {
    const result = await baikeService.getSummaryIdentityProfiles([{ user_id: '10001' }], {})
    assert.deepEqual(result, {})
  } finally {
    Config.get = originalGet
    baikeService.identityService.getUserIdentities = originalIdentityLookup
  }
})

test('master and sponsor descriptions remain differentiated and evidence-aware', () => {
  const identities = {
    10001: { userId: '10001', isMaster: true, isSponsor: false, sponsorAmount: 0 },
    10002: { userId: '10002', isMaster: false, isSponsor: true, sponsorAmount: 30 },
    10003: { userId: '10003', isMaster: true, isSponsor: true, sponsorAmount: 98 }
  }
  const messages = [
    { user_id: '10001', nickname: '主人甲', text: '测试功能' },
    { user_id: '10002', nickname: '赞助乙', text: '提出建议' },
    { user_id: '10003', nickname: '双身份丙', text: '继续优化' }
  ]

  const context = baikeService.buildSummaryIdentityContext(messages, identities)
  const portraits = baikeService.applyIdentityToPortraits([
    { userId: '10001', nickname: '主人甲', tags: [], summary: '关注测试。' },
    { userId: '10002', nickname: '赞助乙', tags: [], summary: '提供建议。' },
    { userId: '10003', nickname: '双身份丙', tags: [], summary: '推动优化。' }
  ], identities)

  assert.match(context, /主人甲.*机器人主人。/)
  assert.match(context, /赞助乙.*赞助用户.*不要称为主人/)
  assert.match(context, /双身份丙.*机器人主人兼赞助用户.*主人身份优先/)
  assert.deepEqual(portraits[0].tags, ['#Bot主人'])
  assert.deepEqual(portraits[1].tags, ['#赞助用户'])
  assert.deepEqual(portraits[2].tags, ['#Bot主人', '#赞助用户'])
  assert.match(portraits[1].summary, /应与机器人主人身份明确区分/)
})

test('explicit numeric mentions retain an at sign before the user chip', () => {
  const html = generateGroupSummaryHTML('群聊总结', {
    highlights: [{ sender: 'Alice', content: '你好 @10002' }]
  }, {
    userMap: {
      10002: { userId: '10002', nickname: 'Bob' }
    }
  })

  assert.match(html, /<span class="mention-prefix">@<\/span>\s*<span class="user-chip/)
})

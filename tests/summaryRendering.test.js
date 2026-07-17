import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.logger = globalThis.logger || {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

const [{ default: baikeService }, { default: MediaService }, { generateGroupSummaryHTML }] = await Promise.all([
  import('../model/services/baikeService.js'),
  import('../model/services/mediaService.js'),
  import('../utils/html.js')
])

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

import assert from 'node:assert/strict'
import test from 'node:test'

import MessageService from '../model/services/messageService.js'

const BILIBILI_MINI_APP_JSON = JSON.stringify({
  ver: '1.0.0.19',
  prompt: '[QQ小程序]炸裂！恋与深空被央视点名多平台账号停更！',
  config: {
    type: 'normal',
    token: 'should-not-be-sent-to-model'
  },
  app: 'com.tencent.miniapp_01',
  view: 'view_8C8E89B49BE609866298ADDFF2DBABA4',
  meta: {
    detail_1: {
      appid: '1109937557',
      title: '哔哩哔哩',
      desc: '炸裂！恋与深空被央视点名多平台账号停更！',
      preview: 'https://qq.ugcimg.cn/very-long-preview-url',
      qqdocurl: 'https://b23.tv/example'
    }
  }
})

function createMessages(count, startTime = Math.floor(Date.now() / 1000) - count) {
  return Array.from({ length: count }, (_, index) => {
    const seq = index + 1
    return {
      message_id: `message-${seq}`,
      message_seq: seq,
      time: startTime + seq,
      sender: {
        user_id: 10000 + (seq % 5),
        nickname: `user-${seq % 5}`
      },
      message: [{ type: 'text', data: { text: `message ${seq}` } }]
    }
  })
}

function getHistorySlice(messages, anchorIndex, count, cap = 20) {
  const end = anchorIndex >= 0 ? anchorIndex + 1 : messages.length
  const actualCount = Math.min(Math.max(1, Number(count) || 1), cap)
  return messages.slice(Math.max(0, end - actualCount), end)
}

test('NapCat mini app JSON is reduced to app name and content title', () => {
  const service = new MessageService()
  const result = service.getJsonCardSummary(BILIBILI_MINI_APP_JSON)

  assert.equal(result, '[QQ小程序 | 应用: 哔哩哔哩 | 标题: 炸裂！恋与深空被央视点名多平台账号停更！]')
  assert.equal(result.includes('token'), false)
  assert.equal(result.includes('preview'), false)
  assert.equal(result.includes('qqdocurl'), false)
})

test('group summary and search context both use the reduced mini app text', async () => {
  const service = new MessageService()
  const message = {
    message_id: 'mini-app-message',
    time: 1784865350,
    sender: {
      user_id: 10001,
      nickname: 'Alice'
    },
    message: [{
      type: 'json',
      data: BILIBILI_MINI_APP_JSON
    }]
  }

  const parsed = await service.parseGroupMessage(message)
  const contextParts = await service.extractContextPartsFromMessage(null, message)

  assert.equal(parsed.text, '[QQ小程序 | 应用: 哔哩哔哩 | 标题: 炸裂！恋与深空被央视点名多平台账号停更！]')
  assert.deepEqual(contextParts, [parsed.text])
})

test('forwarded mini app cards keep the reduced summary instead of raw JSON', async () => {
  const service = new MessageService()
  const result = await service.parseForwardMessage({}, {
    data: {
      content: [{
        sender: { user_id: 10001, nickname: 'Alice' },
        message: [{ type: 'json', data: BILIBILI_MINI_APP_JSON }]
      }]
    }
  })

  assert.deepEqual(result.texts, ['[QQ小程序 | 应用: 哔哩哔哩 | 标题: 炸裂！恋与深空被央视点名多平台账号停更！]'])
  assert.equal(result.orderedTexts[0].includes('should-not-be-sent-to-model'), false)
})

test('forwarded messages preserve sender IDs when different bots share a nickname', async () => {
  const service = new MessageService()
  const result = await service.parseForwardMessage({ self_id: 10001 }, {
    data: {
      content: [
        {
          time: 1784865350,
          sender: { user_id: 10001, nickname: '小助手' },
          message: [{ type: 'text', data: { text: '当前机器人的发言' } }]
        },
        {
          time: 1784865351,
          sender: { user_id: 20002, nickname: '小助手' },
          message: [{ type: 'text', data: { text: '其他机器人的发言' } }]
        }
      ]
    }
  })

  assert.match(result.orderedTexts[0], /消息来源:合并转发/)
  assert.match(result.orderedTexts[0], /发送者身份:当前机器人（QQ精确匹配）/)
  assert.match(result.orderedTexts[0], /用户ID:10001 \| 昵称:小助手/)
  assert.match(result.orderedTexts[1], /发送者身份:第三方发送者（未与当前机器人QQ匹配）/)
  assert.match(result.orderedTexts[1], /用户ID:20002 \| 昵称:小助手/)
  assert.notEqual(result.orderedTexts[0], result.orderedTexts[1])
})

test('nested anonymous forwards remain scoped as unknown third-party messages', async () => {
  const service = new MessageService()
  const result = await service.parseForwardMessage({ self_id: 10001 }, {
    data: {
      content: [{
        sender: { nickname: '匿名' },
        message: [
          { type: 'text', data: { text: '外层匿名发言' } },
          {
            type: 'forward',
            data: {
              content: [{
                sender: { nickname: '某机器人' },
                message: [{ type: 'text', data: { text: '内层未知机器人互动' } }]
              }]
            }
          }
        ]
      }]
    }
  })

  assert.equal(result.orderedTexts.length, 2)
  assert.match(result.orderedTexts[0], /转发嵌套层级:1/)
  assert.match(result.orderedTexts[0], /发送者身份:未知第三方发送者（无QQ，禁止视为当前机器人）/)
  assert.match(result.orderedTexts[0], /昵称:匿名/)
  assert.match(result.orderedTexts[1], /转发嵌套层级:2/)
  assert.match(result.orderedTexts[1], /发送者身份:未知第三方发送者（无QQ，禁止视为当前机器人）/)
  assert.match(result.orderedTexts[1], /昵称:某机器人/)
})

test('bot profile requires exact sender ID before using first person', () => {
  const service = new MessageService()
  const profile = service.formatBotProfile({
    user_id: 10001,
    card: '小助手',
    nickname: '小助手'
  })

  assert.match(profile.promptText, /用户ID与下方机器人QQ完全一致/)
  assert.match(profile.promptText, /其他机器人均为独立第三方/)
  assert.match(profile.promptText, /发送者ID不同或缺失时，一律按第三方发言处理/)
  assert.match(profile.promptText, /显示名称（仅辅助展示，不作为身份判定）/)
})

test('bot profile disables first-person inference when bot ID is unavailable', () => {
  const service = new MessageService()
  const profile = service.formatBotProfile({ nickname: '小助手' })

  assert.match(profile.promptText, /当前机器人QQ未知/)
  assert.match(profile.promptText, /所有发送者均按独立第三方处理/)
  assert.equal(profile.promptText.includes('机器人QQ：'), false)
})

test('group history keeps paging when the protocol returns fewer messages than requested', async () => {
  const service = new MessageService()
  const messages = createMessages(250)
  const calls = []
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(action, params) {
        assert.equal(action, 'get_group_msg_history')
        calls.push(params)
        const anchorIndex = params.message_seq
          ? messages.findIndex(item => item.message_seq === Number(params.message_seq))
          : -1
        return { data: { messages: getHistorySlice(messages, anchorIndex, params.count, 20) } }
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 120, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24
  })

  assert.equal(result.length, 120)
  assert.equal(service.getMessageSeq(result[0]), 131)
  assert.equal(service.getMessageSeq(result.at(-1)), 250)
  assert.ok(calls.length > 2)
  assert.ok(calls.some(params => params.message_seq))
})

test('group history switches to message_id when message_seq does not move the anchor', async () => {
  const service = new MessageService()
  const messages = createMessages(180)
  const calls = []
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(action, params) {
        assert.equal(action, 'get_group_msg_history')
        calls.push(params)
        if (params.message_seq) {
          return { data: { messages: getHistorySlice(messages, -1, params.count, 20) } }
        }
        const anchorIndex = params.message_id
          ? messages.findIndex(item => item.message_id === String(params.message_id))
          : -1
        return { data: { messages: getHistorySlice(messages, anchorIndex, params.count, 20) } }
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 80, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24
  })

  assert.equal(result.length, 80)
  assert.equal(service.getMessageSeq(result[0]), 101)
  assert.equal(service.getMessageSeq(result.at(-1)), 180)
  assert.ok(calls.some(params => params.message_seq))
  assert.ok(calls.some(params => params.message_id))
})

test('group history merges getChatHistory when OneBot pagination cannot advance', async () => {
  const service = new MessageService()
  const messages = createMessages(160)
  let groupHistoryCalls = 0
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(action, params) {
        if (action === 'get_group_msg_history') {
          return { data: { messages: getHistorySlice(messages, -1, params.count, 20) } }
        }
        return { data: { messages: [] } }
      }
    },
    group: {
      async getChatHistory(_seq, count) {
        groupHistoryCalls += 1
        return messages.slice(-count)
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 100, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24
  })

  assert.equal(result.length, 100)
  assert.equal(service.getMessageSeq(result[0]), 61)
  assert.equal(service.getMessageSeq(result.at(-1)), 160)
  assert.equal(groupHistoryCalls, 1)
})

test('group history falls back to getChatHistory when sendApi is unavailable', async () => {
  const service = new MessageService()
  const messages = createMessages(60)
  const event = {
    group_id: 123456,
    group: {
      async getChatHistory(_seq, count) {
        return messages.slice(-count)
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 40, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24
  })

  assert.equal(result.length, 40)
  assert.equal(service.getMessageSeq(result[0]), 21)
  assert.equal(service.getMessageSeq(result.at(-1)), 60)
})

test('group history stops at the configured time boundary after collecting all recent messages', async () => {
  const service = new MessageService()
  const now = Math.floor(Date.now() / 1000)
  const messages = createMessages(120)
  for (const message of messages.slice(0, 60)) {
    message.time = now - (48 * 3600) + message.message_seq
  }
  for (const message of messages.slice(60)) {
    message.time = now - 3600 + message.message_seq
  }
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(action, params) {
        assert.equal(action, 'get_group_msg_history')
        const anchorIndex = params.message_seq
          ? messages.findIndex(item => item.message_seq === Number(params.message_seq))
          : -1
        return { data: { messages: getHistorySlice(messages, anchorIndex, params.count, 20) } }
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 100, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24
  })

  assert.equal(result.length, 60)
  assert.equal(service.getMessageSeq(result[0]), 61)
  assert.equal(service.getMessageSeq(result.at(-1)), 120)
  assert.ok(result.every(message => service.getMessageTime(message) >= now - (24 * 3600)))
})

test('group history pages through the Yunzai group API with reverse order enabled', async () => {
  const service = new MessageService()
  const messages = createMessages(220)
  const groupCalls = []
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(_action, params) {
        return { data: { messages: getHistorySlice(messages, -1, params.count, 20) } }
      }
    },
    group: {
      async getChatHistory(seq, count, reverseOrder) {
        groupCalls.push({ seq, count, reverseOrder })
        const anchorIndex = seq
          ? messages.findIndex(item => item.message_seq === Number(seq))
          : -1
        return getHistorySlice(messages, anchorIndex, count, 20)
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 150, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24,
    returnMeta: true
  })

  assert.equal(result.messages.length, 150)
  assert.equal(service.getMessageSeq(result.messages[0]), 71)
  assert.equal(service.getMessageSeq(result.messages.at(-1)), 220)
  assert.ok(groupCalls.length > 2)
  assert.ok(groupCalls.every(call => call.reverseOrder === true))
  assert.deepEqual(result.meta.batchModes, ['group.getChatHistory'])
  assert.equal(result.meta.fallbackUsed, false)
})

test('a mixed stale Yunzai page does not prematurely satisfy the time boundary', async () => {
  const service = new MessageService()
  const now = Math.floor(Date.now() / 1000)
  const messages = createMessages(220, now - 7200)
  const staleMessages = messages.slice(0, 32).map(message => ({
    ...message,
    time: now - (48 * 3600) + message.message_seq
  }))
  const event = {
    group_id: 123456,
    bot: {
      async sendApi(action, params) {
        assert.equal(action, 'get_group_msg_history')
        const anchorIndex = params.message_seq
          ? messages.findIndex(item => item.message_seq === Number(params.message_seq))
          : -1
        return { data: { messages: getHistorySlice(messages, anchorIndex, params.count, 100) } }
      }
    },
    group: {
      async getChatHistory(seq) {
        if (!seq) {
          return [...staleMessages, ...messages.slice(-68)]
        }
        return [...staleMessages, messages.find(item => item.message_seq === Number(seq))].filter(Boolean)
      }
    }
  }

  const result = await service.getGroupHistoryMessages(event, 150, {
    paginationEnabled: true,
    batchSize: 100,
    batchDelayMs: 0,
    maxAgeHours: 24,
    returnMeta: true
  })

  assert.equal(result.messages.length, 150)
  assert.equal(service.getMessageSeq(result.messages[0]), 71)
  assert.equal(service.getMessageSeq(result.messages.at(-1)), 220)
  assert.equal(result.meta.reachedTimeBoundary, false)
  assert.equal(result.meta.fallbackUsed, false)
  assert.ok(result.meta.batchModes.includes('message_seq'))
})

import assert from 'node:assert/strict'
import test from 'node:test'

import MessageService from '../model/services/messageService.js'

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

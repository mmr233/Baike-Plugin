import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { debugLog } from '../debug.js'
import { sleep } from '../../utils/common.js'
import { getVisibleName } from '../../utils/text.js'

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

class MessageService {
  getTextLikeFileExtensions() {
    return new Set([
      'txt', 'md', 'markdown', 'json', 'xml', 'csv', 'log', 'html', 'htm',
      'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx',
      'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp',
      'cs', 'go', 'rs', 'php', 'rb', 'sh', 'ps1', 'bat', 'cmd',
      'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'sql', 'vue', 'svelte'
    ])
  }

  getMessageData(messageData) {
    return messageData?.data || messageData || {}
  }

  getSegmentData(segmentItem) {
    return segmentItem?.data || segmentItem || {}
  }

  parseJsonCardPayload(raw = '') {
    if (raw && typeof raw === 'object') {
      if (typeof raw.data === 'string') {
        return this.parseJsonCardPayload(raw.data)
      }
      return raw
    }

    const text = String(raw || '').trim()
    if (!text) {
      return null
    }

    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  getJsonCardMetaEntries(payload = {}) {
    const meta = payload?.meta
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return []
    }
    return Object.values(meta).filter(item => item && typeof item === 'object' && !Array.isArray(item))
  }

  getFirstCardText(sources = [], keys = []) {
    for (const source of sources) {
      if (!source || typeof source !== 'object') {
        continue
      }
      for (const key of keys) {
        const value = String(source[key] || '').replace(/\s+/g, ' ').trim()
        if (value) {
          return value
        }
      }
    }
    return ''
  }

  getJsonCardSummary(raw = '') {
    const payload = this.parseJsonCardPayload(raw)
    if (!payload || typeof payload !== 'object') {
      return '[JSON卡片]'
    }

    const metaEntries = this.getJsonCardMetaEntries(payload)
    const sources = [...metaEntries, payload]
    const app = String(payload.app || '').trim().toLowerCase()
    const view = String(payload.view || '').trim().toLowerCase()
    const prompt = String(payload.prompt || '').replace(/\s+/g, ' ').trim()
    const promptText = prompt.replace(/^\[[^\]]+\]\s*/, '').trim()
    const description = String(payload.desc || '').replace(/\s+/g, ' ').trim()
    const isMiniApp = app.includes('miniapp') || view.includes('miniapp') || /小程序/.test(`${prompt}${description}`)
    const isMusic = app.includes('music') || /音乐/.test(`${prompt}${description}`)
    const isNews = app.includes('structmsg') || metaEntries.some(item => item === payload?.meta?.news)
    const hasForwardResource = metaEntries.some(item => String(item.resid || item.res_id || '').trim())

    if (hasForwardResource) {
      return '[合并转发卡片]'
    }

    let typeLabel = '分享卡片'
    if (isMiniApp) typeLabel = 'QQ小程序'
    else if (isMusic) typeLabel = '音乐分享'
    else if (isNews) typeLabel = '网页分享'
    else if (description && description.length <= 16) typeLabel = description

    let appName = ''
    let title = ''
    if (isMiniApp) {
      appName = this.getFirstCardText(sources, ['appName', 'app_name', 'name', 'source', 'tag', 'title'])
      title = this.getFirstCardText(sources, ['desc', 'description', 'summary']) || promptText
    } else {
      appName = this.getFirstCardText(sources, ['appName', 'app_name', 'source', 'tag', 'name'])
      title = this.getFirstCardText(sources, ['title', 'name']) || promptText
    }

    appName = this.truncateContextText(appName, 48)
    title = this.truncateContextText(title, 180)
    if (title && appName && title === appName) {
      title = ''
    }

    const fields = [typeLabel]
    if (appName) fields.push(`应用: ${appName}`)
    if (title) fields.push(`标题: ${title}`)
    return `[${fields.join(' | ')}]`
  }

  getStructuredCardSummary(raw = '', type = 'json') {
    if (type === 'json') {
      return this.getJsonCardSummary(raw)
    }

    const text = String(raw || '')
    const title = text.match(/<(?:title|name)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:title|name)>/i)?.[1]
    return title
      ? `[XML卡片 | 标题: ${this.truncateContextText(title, 180)}]`
      : '[XML卡片]'
  }

  getMediaUrl(data) {
    return data?.url || data?.file || data?.path || ''
  }

  getFileIdCandidates(...sources) {
    const candidates = []

    for (const source of sources) {
      const data = this.getSegmentData(source)
      for (const key of ['file_id', 'fileId', 'fid', 'res_id', 'id']) {
        const value = String(data?.[key] || source?.[key] || '').trim()
        if (value) {
          candidates.push(value)
        }
      }
    }

    return [...new Set(candidates)]
  }

  getSegmentFileName(segmentItem, ...extraSources) {
    const data = this.getSegmentData(segmentItem)
    const candidates = [
      data?.name,
      segmentItem?.name,
      data?.file_name,
      segmentItem?.file_name,
      data?.filename,
      segmentItem?.filename,
      data?.title,
      segmentItem?.title
    ]

    for (const source of extraSources) {
      const item = this.getSegmentData(source)
      candidates.push(
        item?.name,
        source?.name,
        item?.file_name,
        source?.file_name,
        item?.filename,
        source?.filename,
        item?.title,
        source?.title
      )
    }

    for (const candidate of candidates) {
      const value = String(candidate || '').trim()
      if (value) {
        return value
      }
    }

    const mediaCandidates = [
      data?.path,
      segmentItem?.path,
      data?.file,
      segmentItem?.file,
      data?.url,
      segmentItem?.url
    ]

    for (const candidate of mediaCandidates) {
      const normalized = this.normalizeLocalMediaPath(candidate)
      const value = String(normalized || '').trim()
      if (!value) {
        continue
      }

      try {
        const basename = path.basename(value.split('?')[0])
        if (basename && basename !== '.' && basename !== path.sep) {
          return basename
        }
      } catch {}
    }

    return 'file'
  }

  getFileExtension(name = '', fallbackSource = '') {
    const value = String(name || '').trim()
    const getExt = input => {
      const normalized = String(input || '').trim()
      if (!normalized) {
        return ''
      }

      const plain = normalized.split('?')[0].split('#')[0]
      const basename = plain.split(/[\\/]/).pop() || plain
      const dotIndex = basename.lastIndexOf('.')
      if (dotIndex <= 0 || dotIndex === basename.length - 1) {
        return ''
      }

      return basename.slice(dotIndex + 1).toLowerCase()
    }

    return getExt(value) || getExt(fallbackSource)
  }

  isTextLikeFileName(name = '', fallbackSource = '') {
    const ext = this.getFileExtension(name, fallbackSource)
    return this.getTextLikeFileExtensions().has(ext)
  }

  isHttpMediaSource(source = '') {
    return /^https?:\/\//i.test(String(source || '').trim())
  }

  isDataMediaSource(source = '') {
    return /^data:/i.test(String(source || '').trim())
  }

  normalizeLocalMediaPath(source = '') {
    const value = String(source || '').trim()
    if (!value) {
      return ''
    }

    if (/^file:\/\//i.test(value)) {
      try {
        return fileURLToPath(value)
      } catch {
        return value.replace(/^file:\/+/, '')
      }
    }

    return value
  }

  isAccessibleLocalMediaSource(source = '') {
    const localPath = this.normalizeLocalMediaPath(source)
    if (!localPath || this.isHttpMediaSource(localPath) || this.isDataMediaSource(localPath)) {
      return false
    }

    try {
      return fs.existsSync(localPath)
    } catch {
      return false
    }
  }

  getUsableMediaSource(...candidates) {
    for (const candidate of candidates) {
      const value = String(candidate || '').trim()
      if (!value) {
        continue
      }

      if (this.isHttpMediaSource(value) || this.isDataMediaSource(value)) {
        return value
      }

      if (this.isAccessibleLocalMediaSource(value)) {
        return this.normalizeLocalMediaPath(value)
      }
    }

    return ''
  }

  getUsableFileInfoSource(fileInfo = {}) {
    const data = fileInfo?.data || fileInfo || {}
    return this.getUsableMediaSource(
      data?.url,
      fileInfo?.url,
      data?.download_url,
      fileInfo?.download_url,
      data?.downloadUrl,
      fileInfo?.downloadUrl,
      data?.src,
      fileInfo?.src,
      data?.file,
      fileInfo?.file,
      data?.path,
      fileInfo?.path
    )
  }

  async resolveFileSegment(e, segmentItem) {
    const data = this.getSegmentData(segmentItem)
    let url = this.getUsableMediaSource(
      data?.url,
      segmentItem?.url,
      data?.download_url,
      segmentItem?.download_url,
      data?.downloadUrl,
      segmentItem?.downloadUrl
    )
    let fileInfo = null
    const fileIdCandidates = this.getFileIdCandidates(data, segmentItem)

    if (!url && e.bot?.sendApi) {
      for (const candidate of fileIdCandidates) {
        try {
          fileInfo = await e.bot.sendApi('get_file', { file_id: candidate })
        } catch {
          try {
            fileInfo = await e.bot.sendApi('get_file', { file: candidate })
          } catch {
            fileInfo = null
          }
        }

        url = this.getUsableFileInfoSource(fileInfo)
        if (url) {
          break
        }
      }
    }

    if (!url) {
      url = this.getUsableMediaSource(
        this.getMediaUrl(data),
        segmentItem?.file,
        segmentItem?.path,
        data?.path
      )
    }

    const name = this.getSegmentFileName(segmentItem, data, fileInfo)
    const fileId = fileIdCandidates[0] || ''

    return {
      url,
      name,
      ext: this.getFileExtension(name, url),
      file_id: fileId
    }
  }

  getMessageList(messageData) {
    const data = this.getMessageData(messageData)
    const message = data.message || data.content || messageData?.message || messageData?.content || []
    return Array.isArray(message) ? message : []
  }

  getMessageId(messageData) {
    const data = this.getMessageData(messageData)
    return String(data.message_id || messageData?.message_id || data.id || messageData?.id || '')
  }

  getMessageSeq(messageData) {
    const data = this.getMessageData(messageData)
    return Number(data.message_seq || messageData?.message_seq || data.seq || messageData?.seq || 0)
  }

  getMessageTime(messageData) {
    const data = this.getMessageData(messageData)
    return Number(data.time || messageData?.time || 0)
  }

  getMessageSender(messageData) {
    const data = this.getMessageData(messageData)
    const userId = String(data.user_id || data.sender?.user_id || messageData?.user_id || '')
    const card = data.sender?.card || data.card || ''
    const rawNickname = data.sender?.nickname || data.nickname || ''
    const nickname = getVisibleName(card, rawNickname, userId, '未知用户')
    return { userId, nickname, card, rawNickname }
  }

  getMessageAnchor(messageData) {
    const data = this.getMessageData(messageData)
    return data.message_seq
      || messageData?.message_seq
      || data.real_id
      || messageData?.real_id
      || data.seq
      || messageData?.seq
      || data.message_id
      || messageData?.message_id
      || data.id
      || messageData?.id
      || ''
  }

  normalizeHistoryResponseMessages(response) {
    const data = response?.data ?? response
    const candidates = [
      data?.messages,
      data?.message,
      response?.messages,
      response?.message,
      data
    ]

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate
      }
    }

    return []
  }

  formatContextTime(timestamp) {
    if (!timestamp) {
      return ''
    }

    const date = new Date(timestamp * 1000)
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return date.toLocaleString('zh-CN')
  }

  truncateContextText(text = '', maxLength = 200) {
    const normalized = String(text).replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return ''
    }

    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength)}...`
  }

  normalizeProfileObject(value) {
    const data = value?.data || value || {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {}
    }
    return data
  }

  pickProfileValue(profile = {}, fields = []) {
    for (const field of fields) {
      const value = profile?.[field]
      if (value === undefined || value === null) {
        continue
      }
      if (typeof value === 'string' && !value.trim()) {
        continue
      }
      return value
    }
    return ''
  }

  normalizeProfileTextValue(value, maxLength = 120) {
    if (value === undefined || value === null) {
      return ''
    }

    if (Array.isArray(value)) {
      return this.truncateContextText(
        value
          .map(item => this.normalizeProfileTextValue(item, maxLength))
          .filter(Boolean)
          .join(' / '),
        maxLength
      )
    }

    if (typeof value === 'object') {
      for (const field of ['text', 'content', 'nickname', 'name', 'summary', 'description', 'sign']) {
        const nested = this.normalizeProfileTextValue(value[field], maxLength)
        if (nested) {
          return nested
        }
      }
      return ''
    }

    return this.truncateContextText(String(value).trim(), maxLength)
  }

  formatProfileTime(timestamp) {
    const numeric = Number(timestamp)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return ''
    }

    const date = new Date(numeric > 1e12 ? numeric : numeric * 1000)
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return date.toLocaleString('zh-CN')
  }

  async getGroupMemberProfileData(e, groupId, userId) {
    if (!e?.group_id || !userId) {
      return {}
    }

    const normalizedGroupId = Number(groupId) || groupId
    const normalizedUserId = Number(userId) || userId
    const merged = {
      group_id: normalizedGroupId,
      user_id: normalizedUserId
    }

    const tasks = [
      async () => {
        if (!e.group?.pickMember) {
          return {}
        }
        const member = e.group.pickMember(normalizedUserId)
        if (!member) {
          return {}
        }
        const info = typeof member.getInfo === 'function' ? await member.getInfo() : member.info || {}
        return {
          ...this.normalizeProfileObject(member),
          ...this.normalizeProfileObject(info)
        }
      },
      async () => {
        if (!e.bot?.pickMember) {
          return {}
        }
        const member = e.bot.pickMember(normalizedGroupId, normalizedUserId)
        if (!member) {
          return {}
        }
        const info = typeof member.getInfo === 'function' ? await member.getInfo() : member.info || {}
        return {
          ...this.normalizeProfileObject(member),
          ...this.normalizeProfileObject(info)
        }
      },
      async () => {
        if (!e.bot?.sendApi) {
          return {}
        }
        return this.normalizeProfileObject(await e.bot.sendApi('get_group_member_info', {
          group_id: normalizedGroupId,
          user_id: normalizedUserId,
          no_cache: true
        }))
      },
      async () => {
        if (!e.bot?.sendApi) {
          return {}
        }
        return this.normalizeProfileObject(await e.bot.sendApi('get_stranger_info', {
          user_id: normalizedUserId,
          no_cache: true
        }))
      }
    ]

    for (const task of tasks) {
      try {
        Object.assign(merged, this.normalizeProfileObject(await task()))
      } catch {}
    }

    return merged
  }

  formatGroupMemberProfile(profile = {}, userId = '') {
    const actualUserId = String(this.pickProfileValue(profile, ['user_id', 'uid', 'uin']) || userId || '').trim()
    const card = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['card', 'group_name']))
    const nickname = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['nickname', 'name', 'nick']))
    const displayName = card || nickname || actualUserId

    if (!displayName) {
      return ''
    }

    const roleMap = {
      owner: '群主',
      admin: '管理员',
      member: '群成员'
    }
    const sexMap = {
      male: '男',
      female: '女',
      unknown: '未知'
    }

    const roleRaw = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['role']))
    const sexRaw = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['sex', 'gender'])).toLowerCase()
    const role = roleMap[roleRaw] || roleRaw
    const sex = sexMap[sexRaw] || this.normalizeProfileTextValue(this.pickProfileValue(profile, ['sex', 'gender']))
    const age = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['age']))
    const area = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['area', 'location']))
    const title = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['title', 'special_title']))
    const level = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['level', 'member_level']))
    const qid = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['qid']))
    const joinTime = this.formatProfileTime(this.pickProfileValue(profile, ['join_time', 'joinTime']))
    const lastSentTime = this.formatProfileTime(this.pickProfileValue(profile, ['last_sent_time', 'lastSentTime']))
    const note = this.normalizeProfileTextValue(this.pickProfileValue(profile, [
      'long_nick',
      'personal_note',
      'signature',
      'sign',
      'description',
      'summary',
      'bio'
    ]))

    const lines = [`【成员】${displayName}${actualUserId ? `（QQ:${actualUserId}）` : ''}`]

    if (card && nickname && card !== nickname) {
      lines.push(`QQ昵称：${nickname}`)
    }
    if (role) {
      lines.push(`群身份：${role}`)
    }
    if (title) {
      lines.push(`群头衔：${title}`)
    }
    if (level) {
      lines.push(`群等级：${level}`)
    }
    if (sex) {
      lines.push(`性别：${sex}`)
    }
    if (age) {
      lines.push(`年龄：${age}`)
    }
    if (area) {
      lines.push(`地区：${area}`)
    }
    if (qid) {
      lines.push(`QID：${qid}`)
    }
    if (joinTime) {
      lines.push(`入群时间：${joinTime}`)
    }
    if (lastSentTime) {
      lines.push(`最近发言：${lastSentTime}`)
    }
    if (note) {
      lines.push(`个性资料：${note}`)
    }

    return lines.join('\n')
  }

  async getGroupMemberProfiles(e, userIds = []) {
    const uniqueUserIds = [...new Set((userIds || []).map(item => String(item || '').trim()).filter(Boolean))]
    if (uniqueUserIds.length === 0 || !e?.group_id) {
      return ''
    }

    const profiles = []
    for (const userId of uniqueUserIds) {
      const profile = await this.getGroupMemberProfileData(e, e.group_id, userId)
      const formatted = this.formatGroupMemberProfile(profile, userId)
      if (formatted) {
        profiles.push(formatted)
      }
    }

    debugLog('summary.member.profiles', '群成员主页资料获取完成', {
      requestedCount: uniqueUserIds.length,
      injectedCount: profiles.length
    })

    return profiles.join('\n\n')
  }

  getProfileDisplayName(profile = {}, userId = '') {
    const actualUserId = String(this.pickProfileValue(profile, ['user_id', 'uid', 'uin']) || userId || '').trim()
    const card = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['card', 'group_name']))
    const nickname = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['nickname', 'name', 'nick']))
    return card || nickname || actualUserId
  }

  async resolveGroupMemberName(e, userId = '', cache = new Map()) {
    const actualUserId = String(userId || '').trim()
    if (!actualUserId) {
      return ''
    }

    if (cache.has(actualUserId)) {
      return cache.get(actualUserId)
    }

    let displayName = actualUserId
    try {
      const profile = await this.getGroupMemberProfileData(e, e.group_id, actualUserId)
      displayName = this.getProfileDisplayName(profile, actualUserId) || actualUserId
    } catch {}

    cache.set(actualUserId, displayName)
    return displayName
  }

  getBotUserId(e) {
    const candidates = [
      e?.self_id,
      e?.bot?.self_id,
      Array.isArray(e?.bot?.uin) ? e.bot.uin[0] : e?.bot?.uin,
      Array.isArray(globalThis.Bot?.uin) ? globalThis.Bot.uin[0] : globalThis.Bot?.uin,
      Array.isArray(global.Bot?.uin) ? global.Bot.uin[0] : global.Bot?.uin
    ]

    for (const candidate of candidates) {
      const value = String(candidate || '').trim()
      if (value) {
        return value
      }
    }

    return ''
  }

  isBotOwnMessage(e, messageData) {
    const botUserId = this.getBotUserId(e)
    if (!botUserId || !messageData) {
      return false
    }

    const senderId = String(this.getMessageSender(messageData).userId || '').trim()
    return Boolean(senderId) && senderId === botUserId
  }

  filterBotMessagesForSummary(messages = [], e, enabled = true) {
    const list = Array.isArray(messages) ? messages : []
    if (!enabled) {
      return list
    }

    const botUserId = this.getBotUserId(e)
    if (!botUserId) {
      debugLog('message.groupHistory', '群总结机器人消息过滤跳过', {
        filterBotMessages: true,
        reason: 'missingBotUserId',
        beforeCount: list.length,
        afterCount: list.length
      })
      return list
    }

    let filteredCount = 0
    const filtered = list.filter(item => {
      if (this.isBotOwnMessage(e, item)) {
        filteredCount += 1
        return false
      }
      return true
    })

    debugLog('message.groupHistory', '群总结机器人消息过滤完成', {
      filterBotMessages: true,
      botUserId,
      beforeCount: list.length,
      afterCount: filtered.length,
      filteredCount
    })

    return filtered
  }

  async getBotProfileData(e) {
    const botUserId = this.getBotUserId(e)
    if (!botUserId) {
      return {}
    }

    const normalizedUserId = Number(botUserId) || botUserId
    const merged = {
      user_id: normalizedUserId,
      nickname: e?.bot?.nickname || e?.bot?.name || ''
    }

    const tasks = [
      async () => {
        if (!e?.bot?.sendApi) {
          return {}
        }
        return this.normalizeProfileObject(await e.bot.sendApi('get_login_info', {}))
      },
      async () => {
        if (!e?.group_id) {
          return {}
        }
        return this.getGroupMemberProfileData(e, e.group_id, botUserId)
      },
      async () => {
        if (!e?.bot?.sendApi) {
          return {}
        }
        return this.normalizeProfileObject(await e.bot.sendApi('get_stranger_info', {
          user_id: normalizedUserId,
          no_cache: true
        }))
      }
    ]

    for (const task of tasks) {
      try {
        Object.assign(merged, this.normalizeProfileObject(await task()))
      } catch {}
    }

    return merged
  }

  formatBotProfile(profile = {}, fallbackUserId = '') {
    const actualUserId = String(this.pickProfileValue(profile, ['user_id', 'uid', 'uin']) || fallbackUserId || '').trim()
    const card = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['card', 'group_name']))
    const nickname = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['nickname', 'name', 'nick']))
    const roleMap = {
      owner: '群主',
      admin: '管理员',
      member: '群成员'
    }
    const roleRaw = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['role']))
    const role = roleMap[roleRaw] || roleRaw
    const title = this.normalizeProfileTextValue(this.pickProfileValue(profile, ['title', 'special_title']))
    const aliases = [...new Set([card, nickname, actualUserId].filter(Boolean))]

    const lines = actualUserId
      ? [
          '只有发送者用户ID与下方机器人QQ完全一致时，才属于当前正在执行总结的机器人本人。',
          '昵称、群名片、头衔和显示名称仅用于展示，不能单独作为机器人本人身份的判断依据。',
          '合并转发中出现的其他机器人均为独立第三方；即使昵称或群名片与当前机器人相同或相似，也不得当作当前机器人。',
          '仅对发送者用户ID与机器人QQ完全一致的发言使用第一人称“我”；发送者ID不同或缺失时，一律按第三方发言处理。'
        ]
      : [
          '当前机器人QQ未知，无法可靠确认聊天记录中的机器人本人发言。',
          '不要仅凭昵称、群名片、头衔或显示名称使用第一人称“我”；所有发送者均按独立第三方处理。'
        ]

    if (actualUserId) {
      lines.push(`机器人QQ：${actualUserId}`)
    }
    if (card) {
      lines.push(`本群名片：${card}`)
    }
    if (nickname && nickname !== card) {
      lines.push(`QQ昵称：${nickname}`)
    }
    if (role) {
      lines.push(`群身份：${role}`)
    }
    if (title) {
      lines.push(`群头衔：${title}`)
    }
    if (aliases.length > 0) {
      lines.push(`显示名称（仅辅助展示，不作为身份判定）：${aliases.join(' / ')}`)
    }
    if (aliases.length === 0 && !actualUserId) {
      lines.push('机器人显示名称未知。')
    }

    return {
      userId: actualUserId,
      aliases,
      promptText: lines.join('\n')
    }
  }

  async getBotProfileForPrompt(e) {
    const botUserId = this.getBotUserId(e)
    const profile = await this.getBotProfileData(e)
    return this.formatBotProfile(profile, botUserId)
  }

  async extractImages(e, message) {
    const images = []
    const list = Array.isArray(message) ? message : []

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (type !== 'image') {
        continue
      }

      let url = this.getUsableMediaSource(data?.url, segmentItem?.url)
      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_image', { file_id: data.file_id })
          url = this.getUsableMediaSource(fileInfo?.data?.url, fileInfo?.url, fileInfo?.data?.file, fileInfo?.file)
        } catch {}
      }

      if (!url) {
        url = this.getUsableMediaSource(this.getMediaUrl(data), segmentItem?.file, segmentItem?.path)
      }

      if (url) {
        images.push({ type: 'image', url, name: data.name || segmentItem?.name || '' })
      }
    }

    return images
  }

  async extractVideos(e, message) {
    const videos = []
    const list = Array.isArray(message) ? message : []

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (type !== 'video') {
        continue
      }

      let url = this.getUsableMediaSource(
        data?.url,
        segmentItem?.url,
        data?.file,
        segmentItem?.file,
        data?.path,
        segmentItem?.path
      )

      if (!url && data.file && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_video', { file: data.file })
          url = this.getUsableMediaSource(
            fileInfo?.data?.url,
            fileInfo?.url,
            fileInfo?.data?.file,
            fileInfo?.file,
            fileInfo?.data?.path,
            fileInfo?.path
          )
        } catch {}
      }

      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_video', { file: data.file_id })
          url = this.getUsableMediaSource(
            fileInfo?.data?.url,
            fileInfo?.url,
            fileInfo?.data?.file,
            fileInfo?.file,
            fileInfo?.data?.path,
            fileInfo?.path
          )
        } catch {}
      }

      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_file', { file_id: data.file_id })
          url = this.getUsableMediaSource(
            fileInfo?.data?.url,
            fileInfo?.url,
            fileInfo?.data?.file,
            fileInfo?.file,
            fileInfo?.data?.path,
            fileInfo?.path
          )
        } catch {}
      }

      if (url) {
        videos.push({ type: 'video', url, name: data.name || segmentItem?.name || '' })
      }
    }

    return videos
  }

  async extractVoices(e, message) {
    const voices = []
    const list = Array.isArray(message) ? message : []

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (type !== 'record') {
        continue
      }

      let url = this.getUsableMediaSource(data?.url, segmentItem?.url)
      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_record', { file_id: data.file_id, out_format: 'mp3' })
          url = this.getUsableMediaSource(fileInfo?.data?.url, fileInfo?.url, fileInfo?.data?.file, fileInfo?.file)
        } catch {}
      }

      if (!url && data.file && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_record', { file: data.file, out_format: 'mp3' })
          url = this.getUsableMediaSource(fileInfo?.data?.url, fileInfo?.url, fileInfo?.data?.file, fileInfo?.file)
        } catch {}
      }

      if (!url) {
        url = this.getUsableMediaSource(this.getMediaUrl(data), segmentItem?.file, segmentItem?.path)
      }

      if (url) {
        voices.push({ type: 'audio', url, name: data.name || segmentItem?.name || 'voice_message' })
      }
    }

    return voices
  }

  async extractFiles(e, message) {
    const files = []
    const list = Array.isArray(message) ? message : []

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (type !== 'file') {
        continue
      }

      const { url, name, ext, file_id } = await this.resolveFileSegment(e, segmentItem)

      if (!url) {
        continue
      }

      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
        files.push({ type: 'image', url, name })
      } else if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) {
        files.push({ type: 'video', url, name })
      } else if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'amr', 'silk', 'slk'].includes(ext)) {
        files.push({ type: 'audio', url, name })
      } else {
        files.push({ type: 'other', url, name, ext, file_id })
      }
    }

    return files
  }

  async getReplyMessage(e, replySegment) {
    if (!replySegment?.id) {
      return null
    }

    try {
      if (e.getReply) {
        return await e.getReply()
      }
      if (e.group?.getMsg) {
        return await e.group.getMsg(replySegment.id)
      }
      if (e.friend?.getMsg) {
        return await e.friend.getMsg(replySegment.id)
      }
      if (e.bot?.sendApi) {
        const result = await e.bot.sendApi('get_msg', { message_id: replySegment.id })
        debugLog('message.reply', '通过 get_msg 获取引用消息', { replyId: replySegment.id, success: Boolean(result) })
        return result?.data || result
      }
    } catch (error) {
      logger.error(`[百科查询] 获取引用消息失败：${error.message}`)
    }

    return null
  }

  async getMessageById(e, messageId) {
    const actualMessageId = String(messageId || '').trim()
    if (!actualMessageId) {
      return null
    }

    try {
      if (e?.group?.getMsg) {
        return await e.group.getMsg(actualMessageId)
      }
      if (e?.friend?.getMsg) {
        return await e.friend.getMsg(actualMessageId)
      }
      if (e?.bot?.sendApi) {
        const result = await e.bot.sendApi('get_msg', { message_id: actualMessageId })
        return result?.data || result
      }
    } catch (error) {
      debugLog('message.reply', '按消息 ID 获取引用失败', {
        messageId: actualMessageId,
        error: error.message
      })
    }

    return null
  }

  normalizeSummaryTextPart(text = '', maxLength = 800) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return ''
    }

    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
  }

  async buildReplySummaryForGroupMessage(e, replyId = '', options = {}) {
    const actualReplyId = String(replyId || '').trim()
    if (!actualReplyId) {
      return ''
    }

    const cache = options.replyCache instanceof Map ? options.replyCache : null
    if (cache?.has(actualReplyId)) {
      return cache.get(actualReplyId)
    }

    let summary = ''
    try {
      const replyMessage = await this.getMessageById(e, actualReplyId)
      if (replyMessage) {
        const parsed = await this.parseGroupMessage(replyMessage, {
          ...options,
          includeReplyPreview: false
        })
        const sender = parsed.nickname || parsed.user_id || '未知成员'
        const text = this.normalizeSummaryTextPart(parsed.text, 120)
        summary = text ? `[回复 ${sender}: ${text}]` : `[回复 ${sender}]`
      }
    } catch {}

    if (!summary) {
      summary = `[回复消息:${actualReplyId}]`
    }

    cache?.set(actualReplyId, summary)
    return summary
  }

  getSummaryPlaceholderByMediaType(type = '', name = '') {
    if (type === 'image') {
      return '[图片]'
    }
    if (type === 'video') {
      return '[视频]'
    }
    if (type === 'audio') {
      return '[语音]'
    }

    const safeName = String(name || '').trim()
    return safeName ? `[附件:${safeName}]` : '[附件]'
  }

  getSummaryPlaceholdersFromFiles(files = []) {
    const placeholders = []

    for (const file of files || []) {
      placeholders.push(this.getSummaryPlaceholderByMediaType(file?.type, file?.name))
    }

    return placeholders
  }

  async parseForwardMessage(e, forwardSegment, depth = 0) {
    const result = {
      texts: [],
      images: [],
      videos: [],
      audios: [],
      files: [],
      orderedTexts: []
    }

    if (depth > 5) {
      return result
    }

    try {
      const data = this.getSegmentData(forwardSegment)
      const resId = data.id || forwardSegment?.id || data.res_id || forwardSegment?.res_id
      let forwardMessages = []

      if (resId && e.bot?.sendApi) {
        try {
          const response = await e.bot.sendApi('get_forward_msg', {
            message_id: resId,
            id: resId,
            res_id: resId
          })
          forwardMessages = response?.data?.messages || response?.data?.message || response?.messages || response?.message || []
        } catch {}
      }

      if (forwardMessages.length === 0 && e.group?.getForwardMsg && resId) {
        try {
          const response = await e.group.getForwardMsg(resId)
          forwardMessages = response?.messages || response?.message || response || []
        } catch {}
      }

      if (forwardMessages.length === 0 && data.content) {
        forwardMessages = Array.isArray(data.content) ? data.content : [data.content]
      }

      for (const item of forwardMessages) {
        const itemData = item?.data || item || {}
        const message = itemData.message || itemData.content || item?.message || item?.content || []
        const list = Array.isArray(message) ? message : []
        const messageParts = []
        const flushMessageParts = () => {
          if (messageParts.length === 0) {
            return
          }

          const { userId, nickname } = this.getMessageSender(itemData)
          const time = this.formatContextTime(this.getMessageTime(itemData))
          const prefixParts = []
          if (time) {
            prefixParts.push(time)
          }
          if (userId) {
            prefixParts.push(`用户ID:${userId}`)
          }
          if (nickname && nickname !== userId) {
            prefixParts.push(`昵称:${nickname}`)
          }

          const text = messageParts.join(' ')
          result.orderedTexts.push(prefixParts.length > 0 ? `[${prefixParts.join(' | ')}] ${text}` : text)
          messageParts.length = 0
        }

        for (const segmentItem of list) {
          const segmentData = this.getSegmentData(segmentItem)
          const type = segmentItem?.type || segmentData?.type || segmentData?._type || ''

          if (type === 'text') {
            const text = segmentData.text || segmentItem?.text || ''
            if (text.trim()) {
              result.texts.push(text.trim())
              messageParts.push(text.trim())
            }
          } else if (type === 'image') {
            const images = await this.extractImages(e, [segmentItem])
            result.images.push(...images)
            if (images.length > 0) {
              messageParts.push(...images.map(() => this.getSummaryPlaceholderByMediaType('image')))
            }
          } else if (type === 'video') {
            const videos = await this.extractVideos(e, [segmentItem])
            result.videos.push(...videos)
            if (videos.length > 0) {
              messageParts.push(...videos.map(() => this.getSummaryPlaceholderByMediaType('video')))
            }
          } else if (type === 'record') {
            const audios = await this.extractVoices(e, [segmentItem])
            result.audios.push(...audios)
            if (audios.length > 0) {
              messageParts.push(...audios.map(() => this.getSummaryPlaceholderByMediaType('audio')))
            }
          } else if (type === 'file') {
            const files = await this.extractFiles(e, [segmentItem])
            result.files.push(...files)
            messageParts.push(...this.getSummaryPlaceholdersFromFiles(files))
          } else if (type === 'forward') {
            flushMessageParts()
            const nested = await this.parseForwardMessage(e, segmentItem, depth + 1)
            result.texts.push(...nested.texts)
            result.images.push(...nested.images)
            result.videos.push(...nested.videos)
            result.audios.push(...(nested.audios || []))
            result.files.push(...(nested.files || []))
            result.orderedTexts.push(...(nested.orderedTexts || []))
          } else if (type === 'json' || type === 'xml') {
            const raw = segmentData.data || segmentItem?.data || ''
            const summary = this.getStructuredCardSummary(raw, type)
            if (summary) {
              result.texts.push(summary)
              messageParts.push(summary)
            }
          }
        }

        flushMessageParts()
      }
    } catch (error) {
      logger.error(`[百科查询] 解析转发消息失败：${error.message}`)
    }

    return result
  }

  async collectMessageMedia(e, messageData, depth = 0) {
    const result = {
      images: [],
      videos: [],
      audios: [],
      files: []
    }

    if (!messageData || depth > 5) {
      return result
    }

    const data = this.getMessageData(messageData)
    const list = this.getMessageList(messageData)

    if (list.length === 0) {
      const resId = data.res_id || data.id || messageData?.res_id || messageData?.id
      if (resId) {
        const forwardContent = await this.parseForwardMessage(e, { id: resId, res_id: resId }, depth + 1)
        result.images.push(...forwardContent.images)
        result.videos.push(...forwardContent.videos)
        result.audios.push(...(forwardContent.audios || []))
        result.files.push(...(forwardContent.files || []))
      }
      return result
    }

    for (const segmentItem of list) {
      const segmentData = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || segmentData?.type || segmentData?._type || ''

      if (type === 'image') {
        result.images.push(...await this.extractImages(e, [segmentItem]))
      } else if (type === 'video') {
        result.videos.push(...await this.extractVideos(e, [segmentItem]))
      } else if (type === 'record') {
        result.audios.push(...await this.extractVoices(e, [segmentItem]))
      } else if (type === 'file') {
        result.files.push(...await this.extractFiles(e, [segmentItem]))
      } else if (type === 'forward') {
        const forwardContent = await this.parseForwardMessage(e, segmentItem, depth + 1)
        result.images.push(...forwardContent.images)
        result.videos.push(...forwardContent.videos)
        result.audios.push(...(forwardContent.audios || []))
        result.files.push(...(forwardContent.files || []))
      } else if (type === 'json' || type === 'xml') {
        try {
          const raw = segmentData.data || segmentItem?.data || ''
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
          const resId = parsed?.meta?.detail?.resid
          if (resId) {
            const forwardContent = await this.parseForwardMessage(e, { id: resId, res_id: resId }, depth + 1)
            result.images.push(...forwardContent.images)
            result.videos.push(...forwardContent.videos)
            result.audios.push(...(forwardContent.audios || []))
            result.files.push(...(forwardContent.files || []))
          }
        } catch {}
      }
    }

    return result
  }

  async extractContextPartsFromMessage(e, messageData, depth = 0, options = {}) {
    const parts = []
    const list = this.getMessageList(messageData)
    const includeMediaPlaceholders = options.includeMediaPlaceholders !== false

    if (depth > 5) {
      return parts
    }

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''

      if (type === 'text') {
        const text = this.truncateContextText(data.text || segmentItem?.text || '')
        if (text) {
          parts.push(text)
        }
      } else if (type === 'at') {
        const qq = String(data.qq || segmentItem?.qq || data.id || segmentItem?.id || '')
        if (qq && qq !== 'all') {
          parts.push(`@${qq}`)
        }
      } else if (type === 'image' && includeMediaPlaceholders) {
        parts.push('[图片]')
      } else if (type === 'video' && includeMediaPlaceholders) {
        parts.push('[视频]')
      } else if (type === 'record' && includeMediaPlaceholders) {
        parts.push('[语音]')
      } else if (type === 'face') {
        parts.push('[表情]')
      } else if (type === 'file' && includeMediaPlaceholders) {
        const name = data.name || segmentItem?.name || 'file'
        parts.push(`[文件:${name}]`)
      } else if (type === 'forward') {
        const forwardContent = await this.parseForwardMessage(e, segmentItem, depth + 1)
        const textSummary = this.truncateContextText(forwardContent.texts.slice(0, 3).join(' / '), 160)
        const mediaHints = []

        if (includeMediaPlaceholders && forwardContent.images.length > 0) {
          mediaHints.push(`${forwardContent.images.length}张图片`)
        }
        if (includeMediaPlaceholders && forwardContent.videos.length > 0) {
          mediaHints.push(`${forwardContent.videos.length}个视频`)
        }

        if (textSummary) {
          parts.push(`转发消息: ${textSummary}`)
        } else if (mediaHints.length > 0) {
          parts.push(`[转发消息，含${mediaHints.join('、')}]`)
        } else {
          parts.push('[转发消息]')
        }
      } else if (type === 'json' || type === 'xml') {
        const raw = data.data || segmentItem?.data || ''
        const text = this.getStructuredCardSummary(raw, type)
        if (text) {
          parts.push(text)
        }
      }
    }

    if (parts.length === 0 && includeMediaPlaceholders) {
      const data = this.getMessageData(messageData)
      const fallback = this.truncateContextText(data.raw_message || messageData?.raw_message || '', 160)
      if (fallback) {
        parts.push(fallback)
      }
    }

    return parts
  }

  async formatMessageForContext(e, messageData, options = {}) {
    if (!messageData) {
      return ''
    }

    const { userId, nickname } = this.getMessageSender(messageData)
    const time = this.formatContextTime(this.getMessageTime(messageData))
    const text = this.truncateContextText((await this.extractContextPartsFromMessage(e, messageData, 0, options)).join(' '), 260)

    if (!text) {
      return ''
    }

    const prefixParts = []
    if (time) {
      prefixParts.push(time)
    }
    if (nickname || userId) {
      prefixParts.push(userId && nickname && nickname !== userId ? `${nickname}(${userId})` : (nickname || userId))
    }

    return prefixParts.length > 0 ? `[${prefixParts.join(' | ')}] ${text}` : text
  }

  async getRecentChatMessages(e, count, options = {}) {
    const actualCount = Number(count) || 0
    if (actualCount <= 0) {
      return []
    }

    const extraCount = Math.min(actualCount + 10, 30)
    const fetchCount = actualCount + extraCount
    let messages = []

    try {
      if (e.group?.getChatHistory) {
        messages = await e.group.getChatHistory(0, fetchCount, true)
      } else if (e.friend?.getChatHistory) {
        messages = await e.friend.getChatHistory(0, fetchCount, true)
      } else if (e.bot?.sendApi && e.group_id) {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          message_seq: 0,
          count: fetchCount,
          reverseOrder: true
        })
        messages = response?.data?.messages || response?.messages || response?.data || []
      } else if (e.bot?.sendApi && e.user_id) {
        const response = await e.bot.sendApi('get_friend_msg_history', {
          user_id: e.user_id,
          message_seq: 0,
          count: fetchCount,
          reverseOrder: true
        })
        messages = response?.data?.messages || response?.messages || response?.data || []
      }
    } catch (error) {
      logger.error(`[百科查询] 获取最近消息失败：${error.message}`)
    }

    debugLog('message.history', '获取最近消息完成', {
      requestedCount: actualCount,
      fetchedCount: Array.isArray(messages) ? messages.length : 0,
      scope: e.group_id ? 'group' : 'private'
    })

    return this.dedupeAndSortMessages(messages, {
      excludeMessageIds: [...(options.excludeMessageIds || []), e.message_id]
    })
      .slice(-actualCount)
  }

  getMessageUniqueKey(messageData) {
    const id = this.getMessageId(messageData)
    if (id) {
      return `id:${id}`
    }

    const time = this.getMessageTime(messageData)
    const seq = this.getMessageSeq(messageData)
    const { userId } = this.getMessageSender(messageData)
    return `ts:${time}:seq:${seq}:user:${userId}`
  }

  dedupeAndSortMessages(messages = [], options = {}) {
    const excludeIds = new Set(
      (options.excludeMessageIds || [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )
    const uniqueMessages = []
    const seenKeys = new Set()

    for (const item of Array.isArray(messages) ? messages : []) {
      const id = this.getMessageId(item)
      if (id && excludeIds.has(id)) {
        continue
      }

      const key = this.getMessageUniqueKey(item)
      if (seenKeys.has(key)) {
        continue
      }

      seenKeys.add(key)
      uniqueMessages.push(item)
    }

    return uniqueMessages.sort((a, b) => (
      this.getMessageTime(a) - this.getMessageTime(b)
      || this.getMessageSeq(a) - this.getMessageSeq(b)
    ))
  }

  isSameMessage(messageA, messageB) {
    if (!messageA || !messageB) {
      return false
    }

    const idA = this.getMessageId(messageA)
    const idB = this.getMessageId(messageB)
    if (idA && idB) {
      return idA === idB
    }

    return this.getMessageSeq(messageA) === this.getMessageSeq(messageB)
      && this.getMessageTime(messageA) === this.getMessageTime(messageB)
      && this.getMessageSender(messageA).userId === this.getMessageSender(messageB).userId
  }

  selectMessagesAroundAnchor(messages = [], anchorMessage, count) {
    const actualCount = Number(count) || 0
    if (actualCount <= 0 || !anchorMessage) {
      return []
    }

    const sorted = this.dedupeAndSortMessages(messages)
    const anchorIndex = sorted.findIndex(item => this.isSameMessage(item, anchorMessage))
    if (anchorIndex === -1) {
      return []
    }

    const selected = []
    let leftIndex = anchorIndex - 1
    let rightIndex = anchorIndex + 1

    while (selected.length < actualCount && (leftIndex >= 0 || rightIndex < sorted.length)) {
      if (leftIndex >= 0) {
        selected.unshift(sorted[leftIndex])
        leftIndex -= 1
      }

      if (selected.length >= actualCount) {
        break
      }

      if (rightIndex < sorted.length) {
        selected.push(sorted[rightIndex])
        rightIndex += 1
      }
    }

    return selected
  }

  async getChatHistoryMessagesBySeq(e, messageSeq, count, reverseOrder = true) {
    const actualSeq = Number(messageSeq) || 0
    const actualCount = Number(count) || 0
    if (actualSeq <= 0 || actualCount <= 0) {
      return []
    }

    try {
      if (e.group?.getChatHistory) {
        const messages = await e.group.getChatHistory(actualSeq, actualCount, reverseOrder)
        if (Array.isArray(messages) && messages.length > 0) {
          return messages
        }
      } else if (e.friend?.getChatHistory) {
        const messages = await e.friend.getChatHistory(actualSeq, actualCount, reverseOrder)
        if (Array.isArray(messages) && messages.length > 0) {
          return messages
        }
      }
    } catch {}

    try {
      if (e.bot?.sendApi && e.group_id) {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          message_seq: actualSeq,
          count: actualCount,
          reverseOrder
        })
        return response?.data?.messages || response?.messages || response?.data || []
      }

      if (e.bot?.sendApi && e.user_id) {
        const response = await e.bot.sendApi('get_friend_msg_history', {
          user_id: e.user_id,
          message_seq: actualSeq,
          count: actualCount,
          reverseOrder
        })
        return response?.data?.messages || response?.messages || response?.data || []
      }
    } catch {}

    return []
  }

  async getNearbyMessagesForContext(e, anchorMessage, count, options = {}) {
    const actualCount = Number(count) || 0
    if (actualCount <= 0 || !anchorMessage) {
      return []
    }

    const fetchCount = Math.max(actualCount * 3, actualCount + 6)
    const extraRecentCount = Math.max(actualCount * 6, 30)
    const candidates = [anchorMessage]

    try {
      const recentMessages = await this.getRecentChatMessages(e, extraRecentCount, {
        excludeMessageIds: options.excludeMessageIds || []
      })
      candidates.push(...recentMessages)
    } catch {}

    const anchorSeq = this.getMessageSeq(anchorMessage)
    if (anchorSeq > 0) {
      try {
        const previousMessages = await this.getChatHistoryMessagesBySeq(e, anchorSeq, fetchCount, true)
        candidates.push(...previousMessages)
      } catch {}

      try {
        const nextMessages = await this.getChatHistoryMessagesBySeq(e, anchorSeq, fetchCount, false)
        candidates.push(...nextMessages)
      } catch {}
    }

    const nearbyMessages = this.selectMessagesAroundAnchor(
      this.dedupeAndSortMessages(candidates, {
        excludeMessageIds: options.excludeMessageIds || []
      }),
      anchorMessage,
      actualCount
    )

    debugLog('message.replyNearby', '获取引用附近消息完成', {
      anchorSeq,
      requestedCount: actualCount,
      candidateCount: candidates.length,
      nearbyCount: nearbyMessages.length
    })

    return nearbyMessages
  }

  async buildSearchContext(e, options = {}) {
    const historyCount = Math.max(0, Number(options.historyCount) || 0)
    const replyNearbyCount = Math.max(0, Number(options.replyNearbyCount) || 0)
    const filterBotMessages = options.filterBotMessages !== false
    const message = Array.isArray(e.message) ? e.message : []
    const replySegment = message.find(item => item.type === 'reply')
    const replyId = String(replySegment?.id || e.reply_id || '').trim()
    const botUserId = this.getBotUserId(e)
    const isBotMessage = messageData => {
      if (!botUserId || !messageData) {
        return false
      }

      const senderId = String(this.getMessageSender(messageData).userId || '').trim()
      return Boolean(senderId) && senderId === botUserId
    }
    let replyMessage = null
    let replyText = ''
    let replyNearbyMessages = []
    const replyNearbyTexts = []
    let filteredReplyNearbyBotCount = 0
    let filteredHistoryBotCount = 0

    if (replyId) {
      replyMessage = await this.getReplyMessage(e, { id: replyId })
      replyText = await this.formatMessageForContext(e, replyMessage)

      if (replyMessage && replyNearbyCount > 0) {
        replyNearbyMessages = await this.getNearbyMessagesForContext(e, replyMessage, replyNearbyCount, {
          excludeMessageIds: [replyId, e.message_id]
        })

        for (const item of replyNearbyMessages) {
          if (filterBotMessages && isBotMessage(item)) {
            filteredReplyNearbyBotCount += 1
            continue
          }

          const formatted = await this.formatMessageForContext(e, item, {
            includeMediaPlaceholders: false
          })
          if (formatted) {
            replyNearbyTexts.push(formatted)
          }
        }
      }
    }

    const historyMessages = await this.getRecentChatMessages(e, historyCount, {
      excludeMessageIds: replyId ? [replyId] : []
    })
    const historyTexts = []
    const replyNearbyKeys = new Set(replyNearbyMessages.map(item => this.getMessageUniqueKey(item)))

    for (const item of historyMessages) {
      if (filterBotMessages && isBotMessage(item)) {
        filteredHistoryBotCount += 1
        continue
      }

      if (replyNearbyKeys.has(this.getMessageUniqueKey(item))) {
        continue
      }
      const formatted = await this.formatMessageForContext(e, item, {
        includeMediaPlaceholders: false
      })
      if (formatted) {
        historyTexts.push(formatted)
      }
    }

    debugLog('message.context', '搜索上下文构建完成', {
      replyInjected: Boolean(replyText),
      replyNearbyInjectedCount: replyNearbyTexts.length,
      historyInjectedCount: historyTexts.length,
      filterBotMessages,
      botMessageFilteredCount: filteredReplyNearbyBotCount + filteredHistoryBotCount,
      filteredReplyNearbyBotCount,
      filteredHistoryBotCount,
      replyPreview: this.truncateContextText(replyText, 120),
      replyNearbyPreview: replyNearbyTexts.slice(0, 2).map(item => this.truncateContextText(item, 120)),
      historyPreview: historyTexts.slice(0, 2).map(item => this.truncateContextText(item, 120))
    })

    return {
      replyText,
      replyMessage,
      replyNearbyTexts,
      replyNearbyMessages,
      historyTexts,
      historyMessages,
      hasContext: Boolean(replyText || replyNearbyTexts.length > 0 || historyTexts.length > 0)
    }
  }

  extractAtMembers(message) {
    const members = []
    const list = Array.isArray(message) ? message : []

    for (const segmentItem of list) {
      const data = this.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (type !== 'at') {
        continue
      }

      const qq = String(data.qq || segmentItem?.qq || data.id || segmentItem?.id || '')
      if (qq && qq !== 'all') {
        members.push(qq)
      }
    }

    return members
  }

  filterMessagesByTimeRange(messages = [], maxAgeHours = 0) {
    const hours = Number(maxAgeHours) || 0
    if (hours <= 0) {
      return Array.isArray(messages) ? messages : []
    }

    const threshold = Math.floor(Date.now() / 1000) - Math.floor(hours * 3600)
    const filtered = (Array.isArray(messages) ? messages : []).filter(item => {
      const timestamp = this.getMessageTime(item)
      return Number(timestamp) > 0 && timestamp >= threshold
    })

    debugLog('message.groupHistory', '群历史消息时间范围过滤完成', {
      maxAgeHours: hours,
      beforeCount: Array.isArray(messages) ? messages.length : 0,
      afterCount: filtered.length
    })

    return filtered
  }

  getHistoryStartTimestamp(maxAgeHours = 0) {
    const hours = Number(maxAgeHours) || 0
    return hours > 0 ? Math.floor(Date.now() / 1000) - Math.floor(hours * 3600) : 0
  }

  getEarliestHistoryMessage(messages = []) {
    const list = Array.isArray(messages) ? messages.filter(Boolean) : []
    if (list.length === 0) {
      return null
    }

    return list.reduce((earliest, item) => {
      const itemTime = this.getMessageTime(item)
      const earliestTime = this.getMessageTime(earliest)
      const itemSeq = this.getMessageSeq(item)
      const earliestSeq = this.getMessageSeq(earliest)
      if (
        !earliest
        || (itemTime > 0 && (earliestTime <= 0 || itemTime < earliestTime))
        || (itemTime > 0 && itemTime === earliestTime && itemSeq > 0 && (earliestSeq <= 0 || itemSeq < earliestSeq))
      ) {
        return item
      }
      return earliest
    }, list[0])
  }

  createGroupHistoryAnchor(messageData = null) {
    if (!messageData) {
      return null
    }

    const messageSeq = this.getMessageSeq(messageData)
    const messageId = this.getMessageId(messageData)
    return {
      messageSeq: messageSeq > 0 ? messageSeq : '',
      messageId,
      value: messageSeq > 0 ? messageSeq : messageId,
      key: this.getMessageUniqueKey(messageData),
      time: this.getMessageTime(messageData)
    }
  }

  normalizeGroupHistoryAnchor(anchor = null) {
    if (!anchor) {
      return null
    }
    if (typeof anchor === 'object' && !Array.isArray(anchor)) {
      return {
        messageSeq: anchor.messageSeq || anchor.message_seq || '',
        messageId: String(anchor.messageId || anchor.message_id || '').trim(),
        value: anchor.value || anchor.messageSeq || anchor.message_seq || anchor.messageId || anchor.message_id || '',
        key: String(anchor.key || '').trim(),
        time: Number(anchor.time) || 0
      }
    }

    const value = String(anchor).trim()
    return value
      ? { messageSeq: value, messageId: value, value, key: '', time: 0 }
      : null
  }

  isGroupHistoryBatchProgress(messages = [], anchor = null, seenKeys = new Set()) {
    const list = Array.isArray(messages) ? messages.filter(Boolean) : []
    if (list.length === 0) {
      return false
    }

    const normalizedAnchor = this.normalizeGroupHistoryAnchor(anchor)
    if (!normalizedAnchor) {
      return true
    }

    const hasUnseenMessage = list.some(item => !seenKeys.has(this.getMessageUniqueKey(item)))
    if (!hasUnseenMessage) {
      return false
    }

    const earliest = this.getEarliestHistoryMessage(list)
    const nextAnchor = this.createGroupHistoryAnchor(earliest)
    if (!nextAnchor) {
      return false
    }
    if (normalizedAnchor.key && nextAnchor.key === normalizedAnchor.key) {
      return false
    }
    if (normalizedAnchor.time > 0 && nextAnchor.time > normalizedAnchor.time) {
      return false
    }
    if (
      normalizedAnchor.time > 0
      && nextAnchor.time === normalizedAnchor.time
      && Number(normalizedAnchor.messageSeq) > 0
      && Number(nextAnchor.messageSeq) >= Number(normalizedAnchor.messageSeq)
    ) {
      return false
    }

    return true
  }

  async fetchGroupHistoryBatchResult(e, count, anchor = null, seenKeys = new Set(), options = {}) {
    if ((!e.bot?.sendApi && !e.group?.getChatHistory) || !e.group_id) {
      return { messages: [], reason: 'api-unavailable', mode: '' }
    }

    const actualCount = Math.max(1, Number(count) || 1)
    const baseParams = {
      group_id: e.group_id,
      count: actualCount,
      reverseOrder: true
    }
    const normalizedAnchor = this.normalizeGroupHistoryAnchor(anchor)
    const startTimestamp = Number(options.startTimestamp) || 0
    const apiAttempts = normalizedAnchor
      ? [
          ...(normalizedAnchor.messageSeq || normalizedAnchor.value
            ? [{ mode: 'message_seq', params: { ...baseParams, message_seq: normalizedAnchor.messageSeq || normalizedAnchor.value } }]
            : []),
          ...(normalizedAnchor.messageId || normalizedAnchor.value
            ? [{
                mode: 'message_id',
                params: {
                  group_id: e.group_id,
                  count: actualCount,
                  message_id: normalizedAnchor.messageId || normalizedAnchor.value
                }
              }]
            : [])
        ]
      : [
          { mode: 'latest', params: baseParams },
          { mode: 'message_seq:0', params: { ...baseParams, message_seq: 0 } }
        ]
    let receivedNonProgress = false
    const boundaryCandidates = []
    const acceptCandidate = (messages, mode) => {
      if (!this.isGroupHistoryBatchProgress(messages, normalizedAnchor, seenKeys)) {
        receivedNonProgress = true
        return null
      }

      const crossesTimeBoundary = startTimestamp > 0 && messages.some(item => {
        const timestamp = this.getMessageTime(item)
        return timestamp > 0 && timestamp < startTimestamp
      })
      if (!crossesTimeBoundary) {
        return { messages, reason: 'ok', mode }
      }
      boundaryCandidates.push({ messages, mode })
      return null
    }

    if (e.group?.getChatHistory) {
      try {
        const groupAnchor = normalizedAnchor?.messageSeq || normalizedAnchor?.value || 0
        const messages = this.normalizeHistoryResponseMessages(
          await e.group.getChatHistory(groupAnchor, actualCount, true)
        )
        if (messages.length > 0) {
          const accepted = acceptCandidate(messages, 'group.getChatHistory')
          if (accepted) return accepted
        }
      } catch {}
    }

    for (const attempt of e.bot?.sendApi ? apiAttempts : []) {
      try {
        const response = await e.bot.sendApi('get_group_msg_history', attempt.params)
        const messages = this.normalizeHistoryResponseMessages(response)
        if (messages.length === 0) {
          continue
        }
        const accepted = acceptCandidate(messages, attempt.mode)
        if (accepted) return accepted
      } catch {}
    }

    if (boundaryCandidates.length > 0) {
      const messages = this.dedupeAndSortMessages(
        boundaryCandidates.flatMap(candidate => candidate.messages)
      )
      return {
        messages,
        reason: 'ok',
        mode: boundaryCandidates.map(candidate => candidate.mode).join('+')
      }
    }

    return {
      messages: [],
      reason: receivedNonProgress ? 'anchor-not-progressing' : 'empty',
      mode: ''
    }
  }

  async fetchGroupHistoryBatch(e, count, anchor = null, seenKeys = new Set(), options = {}) {
    const result = await this.fetchGroupHistoryBatchResult(e, count, anchor, seenKeys, options)
    return result.messages
  }

  async getGroupHistoryMessagesSingle(e, count, options = {}) {
    if (!e.group_id) {
      return []
    }

    const actualCount = Number(count) || 0
    const candidates = []
    const getResult = () => this.dedupeAndSortMessages(candidates).slice(-actualCount)
    const appendMessages = value => {
      const messages = this.normalizeHistoryResponseMessages(value)
      if (messages.length > 0) {
        candidates.push(...messages)
        return true
      }
      return false
    }

    if (e.bot?.sendApi) {
      try {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          count: actualCount
        })
        if (appendMessages(response) && options.exhaustive !== true) {
          return getResult()
        }
      } catch {}

      try {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          message_seq: 0,
          count: actualCount
        })
        if (appendMessages(response) && options.exhaustive !== true) {
          return getResult()
        }
      } catch {}
    }

    if (e.group?.getChatHistory) {
      try {
        if (appendMessages(await e.group.getChatHistory(0, actualCount, true)) && options.exhaustive !== true) {
          return getResult()
        }
      } catch {}
    }

    if (e.bot?.sendApi) {
      try {
        const response = await e.bot.sendApi('get_history_msg', {
          message_type: 'group',
          group_id: e.group_id,
          count: actualCount
        })
        appendMessages(response)
      } catch {}
    }

    return getResult()
  }

  async getGroupHistoryMessagesPaged(e, count, options = {}) {
    const emptyResult = reason => ({
      messages: [],
      meta: {
        batchCount: 0,
        batchModes: [],
        rawFetchedCount: 0,
        reachedTimeBoundary: false,
        stopReason: reason
      }
    })
    if (!e.group_id || (!e.bot?.sendApi && !e.group?.getChatHistory)) {
      const result = emptyResult('api-unavailable')
      return options.returnMeta ? result : result.messages
    }

    const actualCount = Math.max(0, Number(count) || 0)
    if (actualCount <= 0) {
      const result = emptyResult('invalid-count')
      return options.returnMeta ? result : result.messages
    }

    const batchSize = clampInteger(options.batchSize, 20, 200, 100)
    const batchDelayMs = clampInteger(options.batchDelayMs, 0, 1000, 50)
    const startTimestamp = this.getHistoryStartTimestamp(options.maxAgeHours)
    const allMessages = []
    const seenKeys = new Set()
    let anchor = options.beforeId
      ? this.normalizeGroupHistoryAnchor(options.beforeId)
      : null
    let reachedTimeBoundary = false
    let sawOlderThanBoundary = false
    let batchCount = 0
    let rawFetchedCount = 0
    let stopReason = 'count-reached'
    const batchModes = new Set()

    while (allMessages.length < actualCount) {
      const remainingCount = actualCount - allMessages.length
      const fetchCount = Math.min(batchSize, remainingCount + (anchor ? 1 : 0))
      const batchResult = await this.fetchGroupHistoryBatchResult(e, fetchCount, anchor, seenKeys, {
        startTimestamp
      })
      const messages = batchResult.messages
      if (messages.length === 0) {
        stopReason = batchResult.reason
        break
      }
      batchCount += 1
      rawFetchedCount += messages.length
      if (batchResult.mode) batchModes.add(batchResult.mode)

      let addedInRangeCount = 0
      const inRangeMessages = []
      let batchHasOlderMessage = false
      for (const item of messages) {
        const key = this.getMessageUniqueKey(item)
        if (seenKeys.has(key)) {
          continue
        }
        seenKeys.add(key)

        const timestamp = this.getMessageTime(item)
        if (startTimestamp > 0 && timestamp > 0 && timestamp < startTimestamp) {
          batchHasOlderMessage = true
          sawOlderThanBoundary = true
          continue
        }

        allMessages.push(item)
        inRangeMessages.push(item)
        addedInRangeCount += 1
      }

      if (batchHasOlderMessage && addedInRangeCount === 0) {
        reachedTimeBoundary = true
        stopReason = 'time-boundary'
        break
      }

      const earliest = this.getEarliestHistoryMessage(inRangeMessages.length > 0 ? inRangeMessages : messages)
      const nextAnchor = this.createGroupHistoryAnchor(earliest)
      if (!nextAnchor?.value || (anchor?.key && nextAnchor.key === anchor.key)) {
        stopReason = 'anchor-not-progressing'
        break
      }

      anchor = nextAnchor
      if (batchDelayMs > 0 && allMessages.length < actualCount) {
        await sleep(batchDelayMs)
      }
    }

    const sorted = this.dedupeAndSortMessages(allMessages).slice(-actualCount)
    debugLog('message.groupHistory', '群历史消息分页回溯完成', {
      requestedCount: actualCount,
      batchSize,
      batchDelayMs,
      maxAgeHours: Number(options.maxAgeHours) || 0,
      batchCount,
      batchModes: [...batchModes],
      rawFetchedCount,
      fetchedCount: allMessages.length,
      returnedCount: sorted.length,
      reachedTimeBoundary,
      sawOlderThanBoundary,
      stopReason
    })

    const result = {
      messages: sorted,
      meta: {
        batchCount,
        batchModes: [...batchModes],
        rawFetchedCount,
        reachedTimeBoundary,
        sawOlderThanBoundary,
        stopReason
      }
    }
    return options.returnMeta ? result : result.messages
  }

  async getGroupHistoryMessages(e, count, options = {}) {
    const actualCount = Math.max(0, Number(count) || 0)
    const wrapResult = (messages, meta) => options.returnMeta
      ? { messages, meta }
      : messages
    if (actualCount <= 0) {
      return wrapResult([], { mode: 'none', stopReason: 'invalid-count' })
    }

    if (options.paginationEnabled !== false) {
      const pagedResult = await this.getGroupHistoryMessagesPaged(e, actualCount, {
        ...options,
        returnMeta: true
      })
      const paged = pagedResult.messages
      if (paged.length >= actualCount || pagedResult.meta.reachedTimeBoundary) {
        return wrapResult(paged, {
          mode: 'paged',
          ...pagedResult.meta,
          fallbackUsed: false,
          fallbackCount: 0
        })
      }

      const fallbackMessages = await this.getGroupHistoryMessagesSingle(e, actualCount, { exhaustive: true })
      const merged = this.dedupeAndSortMessages([...paged, ...fallbackMessages]).slice(-actualCount)
      debugLog('message.groupHistory', '群历史分页未完整，已合并一次性后备来源', {
        requestedCount: actualCount,
        pagedCount: paged.length,
        fallbackCount: fallbackMessages.length,
        mergedCount: merged.length,
        stopReason: pagedResult.meta.stopReason
      })
      return wrapResult(merged, {
        mode: 'paged+fallback',
        ...pagedResult.meta,
        fallbackUsed: true,
        fallbackCount: fallbackMessages.length,
        mergedCount: merged.length
      })
    }

    const messages = await this.getGroupHistoryMessagesSingle(e, actualCount)
    const sorted = this.dedupeAndSortMessages(messages).slice(-actualCount)
    debugLog('message.groupHistory', '群历史消息一次性拉取完成', {
      requestedCount: actualCount,
      fetchedCount: Array.isArray(messages) ? messages.length : 0,
      returnedCount: sorted.length,
      paginationEnabled: options.paginationEnabled !== false
    })
    return wrapResult(sorted, {
      mode: 'single',
      stopReason: sorted.length >= actualCount ? 'count-reached' : 'source-exhausted',
      fallbackUsed: false,
      fallbackCount: 0
    })
  }

  async parseGroupMessage(messageData, options = {}) {
    const sender = this.getMessageSender(messageData)
    const result = {
      message_id: this.getMessageId(messageData),
      message_seq: this.getMessageSeq(messageData),
      user_id: sender.userId,
      nickname: sender.nickname,
      card: sender.card || '',
      rawNickname: sender.rawNickname || '',
      time: this.getMessageTime(messageData),
      text: '',
      hasMedia: false,
      imageUrls: [],
      docFiles: [],
      replyToId: '',
      contents: []
    }

    try {
      const data = messageData?.data || messageData || {}
      const message = data.message || data.content || messageData?.message || messageData?.content || []
      const list = Array.isArray(message) ? message : []
      const texts = []

      for (const segmentItem of list) {
        const segmentData = this.getSegmentData(segmentItem)
        const type = segmentItem?.type || segmentData?.type || segmentData?._type || ''

        if (type === 'text') {
          const text = this.normalizeSummaryTextPart(segmentData.text || segmentItem?.text || '')
          if (text) {
            result.contents.push({ type: 'text', text })
            texts.push(text)
          }
        } else if (type === 'image') {
          result.hasMedia = true
          const url = this.getUsableMediaSource(
            this.getMediaUrl(segmentData),
            segmentItem?.url,
            segmentItem?.file,
            segmentItem?.path
          )
          if (url) {
            result.imageUrls.push(url)
          }
          result.contents.push({ type: 'image', url })
          texts.push('[图片]')
        } else if (type === 'video') {
          result.hasMedia = true
          result.contents.push({ type: 'video', url: this.getMediaUrl(segmentData) || segmentItem?.url || segmentItem?.file || '' })
          texts.push('[视频]')
        } else if (type === 'record') {
          result.hasMedia = true
          result.contents.push({ type: 'voice', url: this.getMediaUrl(segmentData) || segmentItem?.url || segmentItem?.file || '' })
          texts.push('[语音]')
        } else if (type === 'file') {
          result.hasMedia = true
          const fileInfo = options.event
            ? await this.resolveFileSegment(options.event, segmentItem)
            : {
                name: this.getSegmentFileName(segmentItem, segmentData),
                url: this.getUsableMediaSource(
                  this.getMediaUrl(segmentData),
                  segmentItem?.url,
                  segmentItem?.file,
                  segmentItem?.path,
                  segmentData?.download_url,
                  segmentItem?.download_url
                ),
                ext: '',
                file_id: this.getFileIdCandidates(segmentData, segmentItem)[0] || ''
              }
          const name = fileInfo.name || 'file'
          const url = fileInfo.url || ''
          const ext = fileInfo.ext || this.getFileExtension(name, url)
          const fileId = fileInfo.file_id || ''

          if (this.isTextLikeFileName(name, url) || ['doc', 'docx', 'pdf'].includes(ext)) {
            result.docFiles.push({ name, url, file_id: fileId })
            texts.push(`[文档:${name}]`)
          } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
            if (url) {
              result.imageUrls.push(url)
            }
            texts.push('[图片]')
          } else {
            texts.push(`[文件:${name}]`)
          }
          result.contents.push({ type: 'file', name, url, ext, file_id: fileId })
        } else if (['face', 'mface', 'bface', 'sface'].includes(type)) {
          result.contents.push({ type: 'emoji', emojiId: String(segmentData.id || segmentItem?.id || '') })
          texts.push('[表情]')
        } else if (type === 'at') {
          const targetId = String(segmentData.qq || segmentItem?.qq || '').trim()
          const targetName = await this.resolveGroupMemberName(options.event, targetId, options.atNameCache)
          const visibleTargetName = getVisibleName(targetName, targetId)
          if (targetId && targetId !== 'all') {
            result.contents.push({ type: 'at', userId: targetId, name: visibleTargetName })
            texts.push(`@${visibleTargetName}`)
          }
        } else if (type === 'reply') {
          const replyId = String(segmentData.id || segmentItem?.id || segmentData.message_id || '').trim()
          result.replyToId = replyId || result.replyToId
          const replySummary = options.includeReplyPreview === false
            ? (replyId ? `[回复消息:${replyId}]` : '[回复消息]')
            : await this.buildReplySummaryForGroupMessage(options.event, replyId, options)
          result.contents.push({ type: 'reply', replyId, summary: replySummary })
          if (replySummary) {
            texts.push(replySummary)
          }
        } else if (type === 'forward') {
          const forwardContent = options.event
            ? await this.parseForwardMessage(options.event, segmentItem)
            : { orderedTexts: [], texts: [], images: [], videos: [], audios: [], files: [] }
          const summary = this.normalizeSummaryTextPart(
            (forwardContent.orderedTexts?.length ? forwardContent.orderedTexts : forwardContent.texts || [])
              .slice(0, 3)
              .join(' / '),
            180
          )
          const mediaHints = [
            forwardContent.images?.length ? `${forwardContent.images.length}张图片` : '',
            forwardContent.videos?.length ? `${forwardContent.videos.length}个视频` : '',
            forwardContent.audios?.length ? `${forwardContent.audios.length}段语音` : '',
            forwardContent.files?.length ? `${forwardContent.files.length}个文件` : ''
          ].filter(Boolean)
          const text = summary
            ? `[转发消息: ${summary}]`
            : mediaHints.length > 0 ? `[转发消息，含${mediaHints.join('、')}]` : '[转发消息]'
          result.contents.push({ type: 'forward', summary, mediaHints })
          texts.push(text)
        } else if (type === 'json' || type === 'xml') {
          const raw = segmentData.data || segmentItem?.data || ''
          const text = this.getStructuredCardSummary(raw, type)
          if (text) {
            result.contents.push({ type, text })
            texts.push(text)
          }
        }
      }

      if (texts.length === 0) {
        result.text = this.normalizeSummaryTextPart(data.raw_message || messageData?.raw_message || '')
      } else {
        result.text = texts.join(' ')
      }
    } catch (error) {
      logger.error(`[百科查询] 解析群消息失败：${error.message}`)
    }

    return result
  }

  async formatMessagesForSummary(messages, filterUserIds = [], options = {}) {
    const formattedMessages = []
    const userMessageCounts = {}
    const hourlyActivity = {}
    const allImageUrls = []
    const allDocFiles = []
    const atNameCache = new Map()
    const replyCache = new Map()
    const targetUserIds = new Set((filterUserIds || []).map(item => String(item || '').trim()).filter(Boolean))

    for (const item of messages || []) {
      const parsed = await this.parseGroupMessage(item, {
        ...options,
        atNameCache,
        replyCache
      })
      if (!parsed.text && !parsed.hasMedia) {
        continue
      }

      if (targetUserIds.size > 0 && !targetUserIds.has(parsed.user_id)) {
        continue
      }

      userMessageCounts[parsed.nickname] = (userMessageCounts[parsed.nickname] || 0) + 1

      if (parsed.time) {
        const hour = new Date(parsed.time * 1000).getHours()
        hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1
      }

      allImageUrls.push(...parsed.imageUrls)
      allDocFiles.push(...parsed.docFiles)

      formattedMessages.push({
        message_id: parsed.message_id,
        message_seq: parsed.message_seq,
        nickname: parsed.nickname,
        card: parsed.card,
        rawNickname: parsed.rawNickname,
        time: parsed.time ? new Date(parsed.time * 1000).toLocaleString('zh-CN') : '',
        timestamp: parsed.time,
        text: parsed.text,
        user_id: parsed.user_id,
        replyToId: parsed.replyToId,
        contents: parsed.contents || []
      })
    }

    return {
      formattedMessages,
      userMessageCounts,
      hourlyActivity,
      allImageUrls,
      allDocFiles
    }
  }

  getUserInfo(e) {
    return {
      user_id: e.user_id,
      nickname: e.sender?.nickname || e.user_id,
      avatar: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.user_id}`
    }
  }
}

export default MessageService

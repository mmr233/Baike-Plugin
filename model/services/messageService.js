import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { debugLog } from '../debug.js'

class MessageService {
  getMessageData(messageData) {
    return messageData?.data || messageData || {}
  }

  getSegmentData(segmentItem) {
    return segmentItem?.data || segmentItem || {}
  }

  getMediaUrl(data) {
    return data?.url || data?.file || data?.path || ''
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
    const nickname = data.sender?.card || data.sender?.nickname || data.nickname || userId || '未知用户'
    return { userId, nickname }
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

    const lines = [
      '这是当前正在执行总结的机器人账号本人；如果聊天记录里出现该账号，请把它视为机器人发言，不要当作普通群友。',
      '涉及机器人发言的分析、点评和吐槽，请使用第一人称“我”来表述，不要用“机器人/它/该账号”等第三人称代称。'
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
      lines.push(`识别名称：${aliases.join(' / ')}`)
    }
    if (aliases.length === 0 && !actualUserId) {
      lines.push('机器人名称未知，但聊天记录中属于机器人账号的消息都应视为机器人本人发言。')
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

      let url = this.getUsableMediaSource(data?.url, segmentItem?.url)
      const name = data.name || segmentItem?.name || 'file'

      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_file', { file_id: data.file_id })
          url = this.getUsableMediaSource(fileInfo?.data?.url, fileInfo?.url, fileInfo?.data?.file, fileInfo?.file, fileInfo?.data?.path, fileInfo?.path)
        } catch {}
      }

      if (!url) {
        url = this.getUsableMediaSource(this.getMediaUrl(data), segmentItem?.file, segmentItem?.path)
      }

      if (!url) {
        continue
      }

      const ext = name.toLowerCase().split('.').pop()
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
        files.push({ type: 'image', url, name })
      } else if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) {
        files.push({ type: 'video', url, name })
      } else if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'amr', 'silk', 'slk'].includes(ext)) {
        files.push({ type: 'audio', url, name })
      } else {
        files.push({ type: 'other', url, name, ext, file_id: data.file_id || '' })
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

  async parseForwardMessage(e, forwardSegment, depth = 0) {
    const result = {
      texts: [],
      images: [],
      videos: [],
      audios: [],
      files: []
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

        for (const segmentItem of list) {
          const segmentData = this.getSegmentData(segmentItem)
          const type = segmentItem?.type || segmentData?.type || segmentData?._type || ''

          if (type === 'text') {
            const text = segmentData.text || segmentItem?.text || ''
            if (text.trim()) {
              result.texts.push(text.trim())
            }
          } else if (type === 'image') {
            result.images.push(...await this.extractImages(e, [segmentItem]))
          } else if (type === 'video') {
            result.videos.push(...await this.extractVideos(e, [segmentItem]))
          } else if (type === 'record') {
            result.audios.push(...await this.extractVoices(e, [segmentItem]))
          } else if (type === 'file') {
            result.files.push(...await this.extractFiles(e, [segmentItem]))
          } else if (type === 'forward') {
            const nested = await this.parseForwardMessage(e, segmentItem, depth + 1)
            result.texts.push(...nested.texts)
            result.images.push(...nested.images)
            result.videos.push(...nested.videos)
            result.audios.push(...(nested.audios || []))
            result.files.push(...(nested.files || []))
          }
        }
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
        const text = this.truncateContextText(typeof raw === 'string' ? raw : JSON.stringify(raw), 160)
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
      this.dedupeAndSortMessages(candidates),
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
          excludeMessageIds: [replyId]
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

  async getGroupHistoryMessages(e, count) {
    if (!e.group_id) {
      return []
    }

    const actualCount = Number(count) || 0
    let messages = []

    if (e.bot?.sendApi) {
      try {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          count: actualCount
        })
        messages = response?.data?.messages || response?.messages || response?.data || []
        if (messages.length > 0) {
          return messages
        }
      } catch {}

      try {
        const response = await e.bot.sendApi('get_group_msg_history', {
          group_id: e.group_id,
          message_seq: 0,
          count: actualCount
        })
        messages = response?.data?.messages || response?.messages || response?.data || []
        if (messages.length > 0) {
          return messages
        }
      } catch {}
    }

    if (e.group?.getChatHistory) {
      try {
        messages = await e.group.getChatHistory(0, actualCount)
        if (messages.length > 0) {
          return messages
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
        messages = response?.data?.messages || response?.messages || response?.data || []
      } catch {}
    }

    return messages
  }

  parseGroupMessage(messageData) {
    const result = {
      user_id: '',
      nickname: '',
      time: 0,
      text: '',
      hasMedia: false,
      imageUrls: [],
      docFiles: []
    }

    try {
      const data = messageData?.data || messageData || {}
      result.user_id = String(data.user_id || data.sender?.user_id || messageData?.user_id || '')
      result.nickname = data.sender?.nickname || data.sender?.card || data.nickname || result.user_id
      result.time = data.time || messageData?.time || 0

      const message = data.message || data.content || messageData?.message || messageData?.content || []
      const list = Array.isArray(message) ? message : []
      const texts = []

      for (const segmentItem of list) {
        const segmentData = this.getSegmentData(segmentItem)
        const type = segmentItem?.type || segmentData?.type || segmentData?._type || ''

        if (type === 'text') {
          const text = segmentData.text || segmentItem?.text || ''
          if (text.trim()) {
            texts.push(text.trim())
          }
        } else if (type === 'image') {
          result.hasMedia = true
          const url = this.getMediaUrl(segmentData) || segmentItem?.url || segmentItem?.file || ''
          if (url) {
            result.imageUrls.push(url)
          }
          texts.push('[图片]')
        } else if (type === 'video') {
          result.hasMedia = true
          texts.push('[视频]')
        } else if (type === 'record') {
          result.hasMedia = true
          texts.push('[语音]')
        } else if (type === 'file') {
          result.hasMedia = true
          const name = segmentData.name || segmentItem?.name || 'file'
          const ext = name.toLowerCase().split('.').pop()
          const url = this.getMediaUrl(segmentData) || segmentItem?.url || ''
          const fileId = segmentData.file_id || ''

          if (['txt', 'doc', 'docx', 'pdf', 'md', 'csv', 'json', 'xml', 'log', 'html', 'htm'].includes(ext)) {
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
        } else if (type === 'face') {
          texts.push('[表情]')
        } else if (type === 'at') {
          texts.push(`@${segmentData.qq || segmentItem?.qq || ''}`)
        }
      }

      result.text = texts.join(' ')
    } catch (error) {
      logger.error(`[百科查询] 解析群消息失败：${error.message}`)
    }

    return result
  }

  formatMessagesForSummary(messages, filterUserIds = []) {
    const formattedMessages = []
    const userMessageCounts = {}
    const hourlyActivity = {}
    const allImageUrls = []
    const allDocFiles = []

    for (const item of messages || []) {
      const parsed = this.parseGroupMessage(item)
      if (!parsed.text && !parsed.hasMedia) {
        continue
      }

      if (filterUserIds.length > 0 && !filterUserIds.includes(parsed.user_id)) {
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
        nickname: parsed.nickname,
        time: parsed.time ? new Date(parsed.time * 1000).toLocaleString('zh-CN') : '',
        timestamp: parsed.time,
        text: parsed.text,
        user_id: parsed.user_id
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

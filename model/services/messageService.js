class MessageService {
  getSegmentData(segmentItem) {
    return segmentItem?.data || segmentItem || {}
  }

  getMediaUrl(data) {
    return data?.url || data?.file || data?.path || ''
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

      let url = this.getMediaUrl(data) || segmentItem?.url || segmentItem?.file || ''
      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_image', { file_id: data.file_id })
          url = fileInfo?.data?.url || fileInfo?.url || ''
        } catch {}
      }

      if (url) {
        images.push({ type: 'image', url })
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

      let url = this.getMediaUrl(data) || segmentItem?.url || segmentItem?.file || ''
      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_record', { file_id: data.file_id, out_format: 'mp4' })
          url = fileInfo?.data?.url || fileInfo?.url || ''
        } catch {}
      }

      if (!url && data.file && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_video', { file: data.file })
          url = fileInfo?.data?.url || fileInfo?.url || ''
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

      let url = this.getMediaUrl(data) || segmentItem?.url || segmentItem?.file || ''
      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_record', { file_id: data.file_id, out_format: 'mp3' })
          url = fileInfo?.data?.url || fileInfo?.url || ''
        } catch {}
      }

      if (!url && data.file && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_record', { file: data.file, out_format: 'mp3' })
          url = fileInfo?.data?.url || fileInfo?.url || ''
        } catch {}
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

      let url = this.getMediaUrl(data) || segmentItem?.url || ''
      const name = data.name || segmentItem?.name || 'file'

      if (!url && data.file_id && e.bot?.sendApi) {
        try {
          const fileInfo = await e.bot.sendApi('get_file', { file_id: data.file_id })
          url = fileInfo?.data?.url || fileInfo?.url || ''
        } catch {}
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
      }
    }

    return files
  }

  async getReplyMessage(e, replySegment) {
    if (!replySegment?.id) {
      return null
    }

    try {
      if (e.group?.getMsg) {
        return await e.group.getMsg(replySegment.id)
      }
      if (e.friend?.getMsg) {
        return await e.friend.getMsg(replySegment.id)
      }
      if (e.bot?.sendApi) {
        const result = await e.bot.sendApi('get_msg', { message_id: replySegment.id })
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
      videos: []
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
          } else if (type === 'forward') {
            const nested = await this.parseForwardMessage(e, segmentItem, depth + 1)
            result.texts.push(...nested.texts)
            result.images.push(...nested.images)
            result.videos.push(...nested.videos)
          }
        }
      }
    } catch (error) {
      logger.error(`[百科查询] 解析转发消息失败：${error.message}`)
    }

    return result
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

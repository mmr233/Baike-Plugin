import fs from 'node:fs'
import Config from '../Config.js'
import resultCache from '../cache.js'
import { pluginName } from '../constant.js'
import ApiService from './apiService.js'
import MediaService from './mediaService.js'
import MessageService from './messageService.js'
import { beautifyText, extractKeyword, formatDetailValue, parseSummaryContent } from '../../utils/text.js'
import { generateGroupSummaryHTML, generateHutaoHTML, generateSearchHTML } from '../../utils/html.js'

const SEND_MODE_PRIORITY = ['html', 'forward', 'text']

class BaikeService {
  constructor() {
    this.apiService = new ApiService()
    this.mediaService = new MediaService()
    this.messageService = new MessageService()
  }

  getFormattedDate(timestamp) {
    const date = new Date(timestamp)
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  getCacheKey(type, id) {
    return `${type}:${id}`
  }

  tryGetCache(key, moduleName) {
    const cacheConfig = Config.get('cache', {})
    const cached = resultCache.get(key, cacheConfig)
    if (!cached) {
      return null
    }

    const expiresAt = cached.timestamp + (cacheConfig.ttl || 10) * 60 * 1000
    logger.info(`${this.getFormattedDate(cached.timestamp)} + ${cacheConfig.ttl} 分钟命中 [${moduleName}] 缓存，将于 ${this.getFormattedDate(expiresAt)} 过期`)
    return cached.data
  }

  setCache(key, value) {
    resultCache.set(key, value, Config.get('cache', {}))
  }

  getSendMode(funcType = '') {
    const sendConfig = Config.get('send', {})
    return sendConfig[funcType] || sendConfig.primaryMode || 'html'
  }

  getNextFallbackMode(currentMode) {
    const currentIndex = SEND_MODE_PRIORITY.indexOf(currentMode)
    if (currentIndex === -1 || currentIndex >= SEND_MODE_PRIORITY.length - 1) {
      return null
    }
    return SEND_MODE_PRIORITY[currentIndex + 1]
  }

  async sendResult(e, forwardMsg, fallbackText = '', htmlContent = null, funcType = '') {
    const autoFallback = Config.get('send.autoFallback', true)
    let sendMode = this.getSendMode(funcType)

    while (sendMode) {
      if (sendMode === 'html' && htmlContent) {
        try {
          const imagePath = await this.mediaService.renderHtmlToImage(htmlContent)
          if (imagePath && fs.existsSync(imagePath)) {
            await e.reply({ type: 'image', file: `file:///${imagePath.replace(/\\/g, '/')}` })
            this.mediaService.cleanupFile(imagePath, 5000)
            return true
          }
        } catch (error) {
          logger.warn(`[${pluginName}] HTML 发送失败：${error.message}`)
        }
      } else if (sendMode === 'forward' && Array.isArray(forwardMsg) && forwardMsg.length > 0) {
        try {
          const forward = Bot?.makeForwardMsg ? await Bot.makeForwardMsg(forwardMsg) : null
          if (forward) {
            await e.reply(forward)
            return true
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 合并转发失败：${error.message}`)
        }
      } else if (sendMode === 'text') {
        if (Array.isArray(forwardMsg) && forwardMsg.length > 0) {
          for (const item of forwardMsg) {
            for (const message of item.message || []) {
              if (message.type === 'text' && message.text) {
                await e.reply(message.text)
              } else if (message.type === 'image' && message.file) {
                await e.reply({ type: 'image', file: message.file })
              }
            }
          }
          return true
        }

        if (fallbackText) {
          await e.reply(fallbackText)
          return true
        }
      }

      if (!autoFallback) {
        break
      }

      sendMode = this.getNextFallbackMode(sendMode)
    }

    if (fallbackText) {
      await e.reply(fallbackText)
      return true
    }

    return false
  }

  async search(e) {
    const keyword = e.msg.startsWith('搜索')
      ? e.msg.replace(/^搜索/, '').trim()
      : extractKeyword(e.msg)

    if (!keyword) {
      await e.reply('请输入要搜索的内容，例如：搜索胡桃')
      return true
    }

    return this.doSearch(e, keyword)
  }

  async summarize(e) {
    const message = Array.isArray(e.message) ? e.message : []
    const replySegment = message.find(item => item.type === 'reply')
    const directImages = await this.messageService.extractImages(e, message)
    const directVideos = await this.messageService.extractVideos(e, message)
    const directVoices = await this.messageService.extractVoices(e, message)
    const atMembers = this.messageService.extractAtMembers(message)

    const hasReplyOrMedia = Boolean(replySegment?.id || directImages.length > 0 || directVideos.length > 0 || directVoices.length > 0)
    if (!hasReplyOrMedia && e.group_id) {
      return this.summarizeGroupChat(e, atMembers)
    }

    if (!hasReplyOrMedia) {
      await e.reply('请引用一条消息，或直接发送图片/视频/语音后使用“总结”')
      return true
    }

    const cacheKey = replySegment?.id
      ? this.getCacheKey('summary', `msg:${replySegment.id}`)
      : this.getCacheKey('summary', `media:${e.message_id || Date.now()}`)
    const cached = this.tryGetCache(cacheKey, '内容总结')

    if (cached?.result) {
      const result = cached.result
      const html = generateHutaoHTML('内容总结', result)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${result}` }] }],
        `内容总结：\n\n${result}`,
        html,
        'contentSummary'
      )
      return true
    }

    await e.reply('正在分析内容，请稍候...')

    try {
      const allTexts = []
      const allImages = [...directImages]
      const allVideos = [...directVideos]
      const allAudios = [...directVoices]

      if (replySegment?.id) {
        const replyMessage = await this.messageService.getReplyMessage(e, replySegment)
        if (!replyMessage) {
          await e.reply('无法获取引用的消息内容')
          return true
        }

        const replyContent = replyMessage.message || replyMessage.content || []
        const replyList = Array.isArray(replyContent) ? replyContent : []

        if (replyList.length === 0) {
          const resId = replyMessage.res_id || replyMessage.id || replySegment.id
          if (resId) {
            const forwardContent = await this.messageService.parseForwardMessage(e, { id: resId, res_id: resId })
            allTexts.push(...forwardContent.texts)
            allImages.push(...forwardContent.images)
            allVideos.push(...forwardContent.videos)
          }
        }

        for (const segmentItem of replyList) {
          const data = this.messageService.getSegmentData(segmentItem)
          const type = segmentItem?.type || data?.type || data?._type || ''

          if (type === 'text') {
            const text = data.text || segmentItem?.text || ''
            if (text.trim()) {
              allTexts.push(text.trim())
            }
          } else if (type === 'image') {
            allImages.push(...await this.messageService.extractImages(e, [segmentItem]))
          } else if (type === 'video') {
            allVideos.push(...await this.messageService.extractVideos(e, [segmentItem]))
          } else if (type === 'record') {
            allAudios.push(...await this.messageService.extractVoices(e, [segmentItem]))
          } else if (type === 'file') {
            const files = await this.messageService.extractFiles(e, [segmentItem])
            for (const file of files) {
              if (file.type === 'image') {
                allImages.push(file)
              } else if (file.type === 'video') {
                allVideos.push(file)
              } else if (file.type === 'audio') {
                allAudios.push(file)
              }
            }
          } else if (type === 'forward') {
            const forwardContent = await this.messageService.parseForwardMessage(e, segmentItem)
            allTexts.push(...forwardContent.texts)
            allImages.push(...forwardContent.images)
            allVideos.push(...forwardContent.videos)
          } else if (type === 'json') {
            try {
              const raw = data.data || segmentItem?.data || ''
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
              const resId = parsed?.meta?.detail?.resid
              if (resId) {
                const forwardContent = await this.messageService.parseForwardMessage(e, { id: resId, res_id: resId })
                allTexts.push(...forwardContent.texts)
                allImages.push(...forwardContent.images)
                allVideos.push(...forwardContent.videos)
              }
            } catch {}
          }
        }
      }

      if (allTexts.length === 0 && allImages.length === 0 && allVideos.length === 0 && allAudios.length === 0) {
        await e.reply('未能从消息中提取到可分析内容')
        return true
      }

      const fileConfig = Config.get('fileRequest', {})
      const imageFiles = await this.mediaService.downloadImages(allImages, 'sum_img', fileConfig.imageMaxPerRequest)
      const videoFiles = await this.mediaService.downloadVideos(allVideos, 'sum_vid', fileConfig.videoMaxPerRequest)
      const audioFiles = await this.mediaService.downloadAudios(allAudios, 'sum_audio', fileConfig.audioMaxPerRequest)
      const mediaFiles = [...imageFiles, ...videoFiles]

      if (audioFiles.length > 0) {
        await e.reply(`正在识别 ${audioFiles.length} 条语音内容...`)
        for (const audio of audioFiles) {
          const mp3Path = await this.mediaService.convertAudioToMp3(audio.localPath)
          const audioResult = mp3Path ? await this.apiService.callAudioAPI(mp3Path) : null
          if (audioResult) {
            allTexts.push(`【语音内容】${audioResult}`)
          }
          this.mediaService.cleanupFile(mp3Path)
        }
        this.mediaService.cleanupFiles(audioFiles)
      }

      const prompt = allTexts.length > 0
        ? `请对以下内容进行全面分析和总结：\n\n${allTexts.join('\n\n')}`
        : '请分析这些媒体内容，描述你看到的内容并进行总结。'

      const result = await this.apiService.callSummaryAPI(prompt, mediaFiles)
      this.mediaService.cleanupFiles(mediaFiles)

      if (!result) {
        await e.reply('总结失败，请稍后重试')
        return true
      }

      this.setCache(cacheKey, { result })
      const html = generateHutaoHTML('内容总结', result)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${result}` }] }],
        `内容总结：\n\n${result}`,
        html,
        'contentSummary'
      )
    } catch (error) {
      logger.error(`[${pluginName}] 内容总结失败`, error)
      await e.reply('总结失败，请稍后重试')
    }

    return true
  }

  async summarizeGroupChat(e, atMembers = [], options = {}) {
    if (!e.group_id) {
      await e.reply('此功能仅在群聊中可用')
      return true
    }

    const chatConfig = Config.get('chatSummary', {})
    const messageCount = Number(options.messageCountOverride)
      || (atMembers.length > 0 ? chatConfig.atMemberMessageCount : chatConfig.defaultMessageCount)
    const actualMembers = [...new Set((atMembers || []).map(String))]
    const cacheType = actualMembers.length > 0 ? 'member' : 'group'
    const cacheId = `${e.group_id}:${actualMembers.sort().join('_') || 'all'}:count:${messageCount}`
    const cacheKey = this.getCacheKey(cacheType, cacheId)
    const moduleName = actualMembers.length > 0 ? '群成员总结' : '群聊总结'
    const cached = this.tryGetCache(cacheKey, moduleName)

    if (cached?.result) {
      const parsed = parseSummaryContent(cached.result)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{
          ...userInfo,
          message: [{
            type: 'text',
            text: `═══ ${cached.title} ═══\n\n📊 消息数量：${cached.statsData.messageCount}条\n👥 活跃成员：${cached.statsData.memberCount}人\n📈 发言排行：${cached.statsData.statsText}\n\n═══ 内容分析 ═══\n\n${cached.result}`
          }]
        }],
        `${cached.title}：\n\n${cached.result}`,
        generateGroupSummaryHTML(cached.title, parsed, {
          ...cached.statsData,
          isMemberMode: cached.isMemberMode
        }),
        cached.isMemberMode ? 'memberSummary' : 'groupChatSummary'
      )
      return true
    }

    const targetText = actualMembers.length > 0 ? `被 @ 的 ${actualMembers.length} 位成员` : '群聊'
    await e.reply(`正在获取${targetText}最近 ${messageCount} 条消息进行分析...`)

    try {
      const messages = await this.messageService.getGroupHistoryMessages(e, Math.min(messageCount, chatConfig.maxMessageCount || 500))
      if (!messages || messages.length === 0) {
        await e.reply('无法获取群聊历史消息，请确认机器人权限')
        return true
      }

      const {
        formattedMessages,
        userMessageCounts,
        hourlyActivity,
        allImageUrls,
        allDocFiles
      } = this.messageService.formatMessagesForSummary(messages, actualMembers)

      if (formattedMessages.length === 0) {
        await e.reply(actualMembers.length > 0 ? '未找到被 @ 成员的有效消息' : '未能解析出有效群消息')
        return true
      }

      let imageSummary = ''
      if (allImageUrls.length > 0) {
        const imageFiles = await this.mediaService.downloadImages(
          allImageUrls.map(url => ({ type: 'image', url })),
          'group_img',
          Config.get('fileRequest.imageMaxPerRequest', 20)
        )

        if (imageFiles.length > 0) {
          const imageResult = await this.apiService.callTextImageAPI('请简要描述这些图片的内容，每张图片用一句话概括。', imageFiles)
          if (imageResult) {
            imageSummary = `\n\n【群聊图片内容】\n${imageResult}`
          }
          this.mediaService.cleanupFiles(imageFiles)
        }
      }

      let docTexts = ''
      for (const doc of allDocFiles.slice(0, 3)) {
        let docUrl = doc.url
        if (!docUrl && doc.file_id && e.bot?.sendApi) {
          try {
            const fileInfo = await e.bot.sendApi('get_file', { file_id: doc.file_id })
            docUrl = fileInfo?.data?.url || fileInfo?.url || ''
          } catch {}
        }

        if (!docUrl) {
          continue
        }

        try {
          const localPath = await this.mediaService.downloadFile(docUrl, `doc_${Date.now()}_${doc.name}`)
          if (localPath && fs.existsSync(localPath)) {
            const content = fs.readFileSync(localPath, 'utf8')
            const limit = chatConfig.docMaxChars || 2000
            const truncated = content.slice(0, limit)
            docTexts += `\n\n【文档: ${doc.name}】\n${truncated}${content.length > limit ? '...(已截断)' : ''}`
            this.mediaService.cleanupFile(localPath)
          }
        } catch {}
      }

      const sortedMembers = Object.entries(userMessageCounts).sort((a, b) => b[1] - a[1])
      const statsText = sortedMembers.slice(0, 10).map(([name, count]) => `${name}: ${count}条`).join('、')
      const messageTexts = formattedMessages.map(item => `[${item.time}] ${item.nickname}: ${item.text}`).join('\n')
      const extraContext = `${imageSummary}${docTexts}`
      const promptTemplate = actualMembers.length > 0
        ? Config.get('prompt.groupMember', '')
        : Config.get('prompt.groupChat', '')

      const prompt = promptTemplate
        .replace('{statsText}', statsText)
        .replace('{extraContext}', extraContext)
        .replace('{messageTexts}', messageTexts)

      const result = await this.apiService.callTextImageAPI(prompt, [])
      if (!result) {
        await e.reply('总结失败，请稍后重试')
        return true
      }

      const title = actualMembers.length > 0 ? '成员发言总结' : '群聊总结'
      const isMemberMode = actualMembers.length > 0
      const statsData = {
        messageCount: formattedMessages.length,
        memberCount: Object.keys(userMessageCounts).length,
        sortedMembers,
        hourlyActivity,
        statsText
      }

      this.setCache(cacheKey, {
        result,
        statsData,
        title,
        isMemberMode
      })

      const parsed = parseSummaryContent(result)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{
          ...userInfo,
          message: [{
            type: 'text',
            text: `═══ ${title} ═══\n\n📊 消息数量：${statsData.messageCount}条\n👥 活跃成员：${statsData.memberCount}人\n📈 发言排行：${statsText}\n\n═══ 内容分析 ═══\n\n${result}`
          }]
        }],
        `${title}：\n\n${result}`,
        generateGroupSummaryHTML(title, parsed, { ...statsData, isMemberMode }),
        isMemberMode ? 'memberSummary' : 'groupChatSummary'
      )
    } catch (error) {
      logger.error(`[${pluginName}] 群聊总结失败`, error)
      await e.reply('总结失败，请稍后重试')
    }

    return true
  }

  async doSearch(e, keyword) {
    const userInfo = this.messageService.getUserInfo(e)
    const cacheKey = this.getCacheKey('search', keyword)
    const cached = this.tryGetCache(cacheKey, '搜索')
    let data = cached?.data || null
    let citations = cached?.citations || []
    const screenshotPaths = []

    if (!data) {
      try {
        const searchResult = await this.apiService.searchKeyword(keyword)
        if (!searchResult.content) {
          await e.reply(`未找到“${keyword}”的相关信息`)
          return true
        }

        citations = searchResult.citations || []
        data = await this.apiService.organizeSearchResult(keyword, searchResult.content)

        if (!data?.详细信息 && !data?.总结) {
          data = { 总结: searchResult.content }
        }

        this.setCache(cacheKey, { data, citations })
      } catch (error) {
        if (error.name === 'AbortError') {
          await e.reply('查询超时，请稍后重试')
        } else {
          logger.error(`[${pluginName}] 搜索失败`, error)
          await e.reply('查询失败，请稍后重试')
        }
        return true
      }
    }

    try {
      const forwardMsg = []

      if (data.详细信息) {
        let detailText = `═══ ${keyword} - 详细信息 ═══\n\n`
        if (typeof data.详细信息 === 'object') {
          for (const [key, value] of Object.entries(data.详细信息)) {
            detailText += `【${key}】\n${formatDetailValue(value, '  ')}\n\n`
          }
        } else {
          detailText += beautifyText(data.详细信息)
        }
        forwardMsg.push({ ...userInfo, message: [{ type: 'text', text: detailText }] })
      }

      if (data.总结) {
        forwardMsg.push({
          ...userInfo,
          message: [{ type: 'text', text: `═══ ${keyword} - 总结 ═══\n\n${beautifyText(data.总结)}` }]
        })
      }

      if (citations.length > 0) {
        forwardMsg.push({
          ...userInfo,
          message: [{
            type: 'text',
            text: `═══ ${keyword} - 参考来源 ═══\n\n${citations.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
          }]
        })

        const screenshotCount = Config.get('send.searchScreenshotCount', -1)
        if (screenshotCount !== 0) {
          const mode = Config.get('send.searchScreenshotMode', 'viewport')
          const limit = screenshotCount === -1 ? citations.length : Math.min(citations.length, screenshotCount)
          const targets = citations.slice(0, limit)

          for (let index = 0; index < targets.length; index += 1) {
            const screenshot = await this.mediaService.captureScreenshot(targets[index], index, mode)
            if (screenshot && fs.existsSync(screenshot)) {
              screenshotPaths.push(screenshot)
              forwardMsg.push({
                ...userInfo,
                message: [
                  { type: 'text', text: `来源 ${index + 1}: ${targets[index]}` },
                  { type: 'image', file: `file:///${screenshot.replace(/\\/g, '/')}` }
                ]
              })
            }
          }
        }
      }

      const html = generateSearchHTML(keyword, data.详细信息, beautifyText(data.总结 || ''), citations)
      await this.sendResult(
        e,
        forwardMsg,
        beautifyText(data.总结 || '查询完成'),
        html,
        'search'
      )
    } catch (error) {
      logger.error(`[${pluginName}] 搜索结果发送失败`, error)
      await e.reply('结果处理失败，请稍后重试')
    } finally {
      this.mediaService.cleanupFiles(screenshotPaths)
    }

    return true
  }
}

export default new BaikeService()

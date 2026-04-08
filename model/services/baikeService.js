import fs from 'node:fs'
import Config from '../Config.js'
import resultCache from '../cache.js'
import { debugLog } from '../debug.js'
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

  appendExtractedFiles(files, containers = {}) {
    for (const file of files || []) {
      if (file.type === 'image') {
        containers.images?.push(file)
      } else if (file.type === 'video') {
        containers.videos?.push(file)
      } else if (file.type === 'audio') {
        containers.audios?.push(file)
      } else {
        containers.others?.push(file)
      }
    }
  }

  sanitizeFilename(name = 'file') {
    const safeName = String(name).replace(/[^\w.-]+/g, '_').slice(-60)
    return safeName || 'file'
  }

  isTextLikeAttachment(name = '') {
    return this.messageService.isTextLikeFileName(name)
  }

  getOtherAttachmentPreviewLimit(fallback = 1500) {
    const fileConfig = Config.get('fileRequest', {})
    return Math.max(100, Number(fileConfig.otherTextPreviewChars) || fallback)
  }

  buildSearchContent(data = {}, fallbackText = '') {
    const sections = []
    const seen = new Set()
    const pushSection = (title, value) => {
      const text = beautifyText(String(value || '').trim())
      const normalized = text.replace(/\s+/g, ' ').trim()
      if (!normalized || seen.has(normalized)) {
        return
      }

      seen.add(normalized)
      sections.push(title ? `【${title}】\n${text}` : text)
    }

    if (data?.总结) {
      pushSection('总结', data.总结)
    }

    if (data?.详细信息) {
      if (typeof data.详细信息 === 'object') {
        for (const [key, value] of Object.entries(data.详细信息)) {
          pushSection(key, formatDetailValue(value, '  '))
        }
      } else {
        pushSection('详细信息', data.详细信息)
      }
    }

    if (data?.内容) {
      pushSection(sections.length > 0 ? '补充内容' : '内容', data.内容)
    }

    if (sections.length > 0) {
      return sections.join('\n\n')
    }

    return beautifyText(fallbackText || '')
  }

  getMediaNameHints(items = [], limit = 3) {
    const names = [...new Set(
      (items || [])
        .map(item => String(item?.name || '').trim())
        .filter(Boolean)
    )]

    if (names.length === 0) {
      return ''
    }

    const visible = names.slice(0, limit).join('、')
    return names.length > limit ? `${visible} 等${names.length}个文件` : visible
  }

  flushOrderedSummaryParts(parts = [], orderedTexts = []) {
    if (!Array.isArray(parts) || parts.length === 0) {
      return
    }

    const text = parts.join(' ').trim()
    if (text) {
      orderedTexts.push(text)
    }
    parts.length = 0
  }

  buildSummaryDisplayText(result = '', notices = []) {
    const actualResult = String(result || '').trim()
    const actualNotices = Array.isArray(notices) ? notices.filter(Boolean) : []

    if (actualNotices.length === 0) {
      return actualResult
    }

    return [
      actualResult,
      '【处理提示】',
      ...actualNotices.map((item, index) => `${index + 1}. ${item}`)
    ].filter(Boolean).join('\n\n')
  }

  hasBracketSections(text = '') {
    return /(?:^|\n)【[^】\n]+】\s*\n/.test(String(text || ''))
  }

  buildSummaryHtmlContent(result = '') {
    const actualResult = beautifyText(String(result || '').trim())
    if (!actualResult) {
      return ''
    }

    if (this.hasBracketSections(actualResult)) {
      return actualResult
    }

    const blocks = actualResult
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map(item => item.trim())
      .filter(Boolean)

    if (blocks.length === 0) {
      return actualResult
    }

    if (blocks.length === 1) {
      return `【摘要】\n${blocks[0]}`
    }

    if (blocks.length === 2) {
      return [
        `【摘要】\n${blocks[0]}`,
        `【要点】\n${blocks[1]}`
      ].join('\n\n')
    }

    return [
      `【摘要】\n${blocks[0]}`,
      `【要点】\n${blocks.slice(1, -1).join('\n\n')}`,
      `【补充说明】\n${blocks[blocks.length - 1]}`
    ].join('\n\n')
  }

  buildImageOverflowNotices(summaryMeta = {}, options = {}) {
    const notices = []
    const skippedSourceCount = Math.max(0, Number(summaryMeta?.skippedSourceCount) || 0)
    const skippedSegmentCount = Math.max(0, Number(summaryMeta?.skippedSegmentCount) || 0)
    const processedCount = Math.max(0, Number(options.processedCount) || 0)
    const totalLimit = Math.max(0, Number(options.totalLimit) || 0)

    if (skippedSourceCount > 0 || skippedSegmentCount > 0) {
      const detailParts = []
      if (skippedSourceCount > 0) {
        detailParts.push(`${skippedSourceCount} 张原始图片未送入模型`)
      }
      if (skippedSegmentCount > 0) {
        detailParts.push(`${skippedSegmentCount} 个长图片段被截断`)
      }

      notices.push(
        `图片数量超过处理上限，本次仅分析前 ${processedCount} 张${totalLimit > 0 ? `（上限 ${totalLimit} 张）` : ''}；${detailParts.join('，')}。`
      )
    }

    return notices
  }

  async summarizeOtherFiles(otherFiles = [], maxCount = 5, options = {}) {
    const actualLimit = Math.max(0, Number(maxCount) || 0)
    if (actualLimit <= 0 || otherFiles.length === 0) {
      return []
    }

    const texts = []
    const previewLimit = Math.max(
      100,
      Number(options.previewLimit) || this.getOtherAttachmentPreviewLimit()
    )
    const includeLimitNote = options.includeLimitNote !== false
    const targets = otherFiles.slice(0, actualLimit)

    for (let index = 0; index < targets.length; index += 1) {
      const file = targets[index]
      if (!file?.url) {
        continue
      }

      const localPath = await this.mediaService.downloadFile(
        file.url,
        `sum_other_${Date.now()}_${index}_${this.sanitizeFilename(file.name)}`
      )

      if (!localPath) {
        texts.push(`【附件:${file.name}】下载失败，无法提取内容`)
        continue
      }

      try {
        if (this.isTextLikeAttachment(file.name)) {
          const content = fs.readFileSync(localPath, 'utf8')
          const normalized = content.trim()
          if (normalized) {
            const truncated = normalized.slice(0, previewLimit)
            texts.push(`【附件:${file.name}】\n${truncated}${normalized.length > previewLimit ? '\n...(已截断)' : ''}`)
          } else {
            texts.push(`【附件:${file.name}】文件内容为空`)
          }
        } else {
          const ext = this.messageService.getFileExtension(file.name, file.url)
          if (['doc', 'docx', 'pdf'].includes(ext)) {
            texts.push(`【附件:${file.name}】已检测到 Word/PDF 文档，当前版本暂不直接提取正文或内嵌图片，请结合文件名理解其主题`)
          } else {
            texts.push(`【附件:${file.name}】已检测到附件，但当前仅支持直接提取文本类文件内容，请结合文件名理解其主题`)
          }
        }
      } catch (error) {
        texts.push(`【附件:${file.name}】读取失败：${error.message}`)
      } finally {
        this.mediaService.cleanupFile(localPath)
      }
    }

    if (includeLimitNote && otherFiles.length > targets.length) {
      texts.push(`【附件处理说明】还有 ${otherFiles.length - targets.length} 个附件未处理，已达到配置上限 ${actualLimit}`)
    }

    debugLog('summary.files', '其他附件处理完成', {
      totalFiles: otherFiles.length,
      processedFiles: targets.length,
      maxCount: actualLimit
    })

    return texts
  }

  getSearchContextMediaLimits() {
    const fileConfig = Config.get('fileRequest', {})
    return {
      imageMaxPerRequest: Math.max(0, Math.min(Number(fileConfig.imageMaxPerRequest) || 0, 3)),
      videoMaxPerRequest: Math.max(0, Math.min(Number(fileConfig.videoMaxPerRequest) || 0, 1)),
      audioMaxPerRequest: Math.max(0, Math.min(Number(fileConfig.audioMaxPerRequest) || 0, 1)),
      otherMaxPerRequest: Math.max(0, Math.min(Number(fileConfig.otherMaxPerRequest) || 0, 2))
    }
  }

  getSummaryFileLimits() {
    const fileConfig = Config.get('fileRequest', {})
    const loopLimit = Math.max(1, Math.min(Number(fileConfig.maxRequestLoops) || 1, 10))
    const imageMaxPerRequest = Math.max(0, Number(fileConfig.imageMaxPerRequest) || 0)
    const videoMaxPerRequest = Math.max(0, Number(fileConfig.videoMaxPerRequest) || 0)
    const audioMaxPerRequest = Math.max(0, Number(fileConfig.audioMaxPerRequest) || 0)
    const otherMaxPerRequest = Math.max(0, Number(fileConfig.otherMaxPerRequest) || 0)

    return {
      loopLimit,
      imageMaxPerRequest,
      videoMaxPerRequest,
      audioMaxPerRequest,
      otherMaxPerRequest,
      totalImageLimit: imageMaxPerRequest * loopLimit,
      totalVideoLimit: videoMaxPerRequest * loopLimit,
      totalAudioLimit: audioMaxPerRequest * loopLimit,
      totalOtherLimit: otherMaxPerRequest * loopLimit
    }
  }

  async summarizeImageBatches(prompt, imageFiles = [], batchLimit = 0, loopLimit = 1, label = '图片') {
    const actualBatchLimit = Math.max(0, Number(batchLimit) || 0)
    if (actualBatchLimit <= 0 || imageFiles.length === 0) {
      return ''
    }

    const totalBatches = Math.ceil(imageFiles.length / actualBatchLimit)
    const actualBatches = Math.min(totalBatches, Math.max(1, Number(loopLimit) || 1))
    const results = []

    for (let batch = 0; batch < actualBatches; batch += 1) {
      const chunk = imageFiles.slice(batch * actualBatchLimit, (batch + 1) * actualBatchLimit)
      const result = await this.apiService.callImageAPI(prompt, chunk)
      if (result) {
        results.push(actualBatches > 1 ? `【第${batch + 1}批${label}】\n${result}` : result)
      }
    }

    return results.join('\n\n')
  }

  messageLikelyContainsMedia(messageData) {
    if (!messageData) {
      return false
    }

    const content = messageData.message || messageData.content || []
    const list = Array.isArray(content) ? content : []
    for (const segmentItem of list) {
      const data = this.messageService.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''
      if (['image', 'video', 'record', 'file', 'forward', 'json', 'xml'].includes(type)) {
        return true
      }
    }

    const rawMessage = String(messageData?.raw_message || '')
    return /\[CQ:(image|video|record|file|forward)/i.test(rawMessage)
  }

  pickRecentMediaMessageForSearchContext(e, context = {}) {
    const historyMessages = Array.isArray(context.historyMessages) ? context.historyMessages : []
    if (historyMessages.length === 0) {
      return null
    }

    const currentUserId = String(e?.user_id || '').trim()
    let fallbackMessage = null

    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
      const item = historyMessages[index]
      if (!this.messageLikelyContainsMedia(item)) {
        continue
      }

      const senderId = String(this.messageService.getMessageSender(item).userId || '').trim()
      if (currentUserId && senderId === currentUserId) {
        return item
      }

      if (!fallbackMessage) {
        fallbackMessage = item
      }
    }

    return fallbackMessage
  }

  async describeSearchContextMedia(e, messageData, label = '引用消息') {
    if (!messageData) {
      return ''
    }

    const mediaLimits = this.getSearchContextMediaLimits()
    const collected = await this.messageService.collectMessageMedia(e, messageData)
    const allImages = [...(collected.images || [])]
    const allVideos = [...(collected.videos || [])]
    const allAudios = [...(collected.audios || [])]
    const allOtherFiles = []

    this.appendExtractedFiles(collected.files || [], {
      images: allImages,
      videos: allVideos,
      audios: allAudios,
      others: allOtherFiles
    })

    if (allImages.length === 0 && allVideos.length === 0 && allAudios.length === 0 && allOtherFiles.length === 0) {
      return ''
    }

    let imageFiles = []
    let videoFiles = []
    let audioFiles = []
    const parts = []

    try {
      if (mediaLimits.imageMaxPerRequest > 0) {
        try {
          imageFiles = await this.mediaService.downloadImages(allImages, 'ctx_img', mediaLimits.imageMaxPerRequest)
        } catch (error) {
          logger.warn(`[${pluginName}] ${label}图片下载失败：${error.message}`)
        }
      }

      if (imageFiles.length > 0) {
        try {
          const imageSummary = await this.apiService.callImageAPI(
            `${label}包含图片。请识别其中最有助于回答“这是什么 / 他是谁 / 她是谁”的主体、角色名、作品名、品牌、地点、界面标题和图片文字。直接输出简洁中文，不要使用 markdown，也不要编造。`,
            imageFiles,
            '你是一个搜索上下文图片理解助手。请只提取有助于后续搜索消解指代的关键信息，优先识别人物、角色、物体、地点、作品名、品牌和图片中的文字。直接输出简洁中文，不要使用 markdown，不要编造。'
          )
          if (imageSummary) {
            parts.push(`图片内容：${this.messageService.truncateContextText(imageSummary, 320)}`)
          }
        } catch (error) {
          logger.warn(`[${pluginName}] ${label}图片理解失败：${error.message}`)
        }
      }

      if (mediaLimits.videoMaxPerRequest > 0) {
        const videoHint = this.getMediaNameHints(allVideos)

        try {
          videoFiles = await this.mediaService.downloadVideos(
            allVideos,
            'ctx_vid',
            mediaLimits.videoMaxPerRequest,
            { timeoutMs: 15000 }
          )

          if (videoFiles.length > 0) {
            const videoSummary = await this.apiService.callVideoAPI(
              `${label}包含视频。请识别最有助于回答“这是什么 / 他是谁 / 她是谁”的主体、场景、字幕和关键台词。直接输出简洁中文，不要使用 markdown，也不要编造。`,
              videoFiles,
              '你是一个搜索上下文视频理解助手。请只提取有助于后续搜索消解指代的关键信息，优先识别人物、角色、物体、场景、字幕和关键台词。直接输出简洁中文，不要使用 markdown，不要编造。'
            )
            if (videoSummary) {
              parts.push(`视频内容：${this.messageService.truncateContextText(videoSummary, 320)}`)
            } else if (videoHint) {
              parts.push(`视频文件：${videoHint}`)
            }
          } else if (allVideos.length > 0) {
            parts.push(videoHint ? `视频文件：${videoHint}` : '包含视频，但当前环境未能直接读取原文件')
          }
        } catch (error) {
          logger.warn(`[${pluginName}] ${label}视频处理失败：${error.message}`)
          if (allVideos.length > 0) {
            parts.push(videoHint ? `视频文件：${videoHint}` : '包含视频，但当前环境未能直接读取原文件')
          }
        }
      }

      if (mediaLimits.audioMaxPerRequest > 0) {
        try {
          audioFiles = await this.mediaService.downloadAudios(allAudios, 'ctx_audio', mediaLimits.audioMaxPerRequest)
        } catch (error) {
          logger.warn(`[${pluginName}] ${label}语音下载失败：${error.message}`)
        }
      }

      if (audioFiles.length > 0) {
        const audioTexts = []
        for (const audio of audioFiles) {
          try {
            const mp3Path = await this.mediaService.convertAudioToMp3(audio.localPath)
            const audioResult = mp3Path ? await this.apiService.callAudioAPI(mp3Path) : null
            if (audioResult) {
              audioTexts.push(this.messageService.truncateContextText(audioResult, 200))
            }
            this.mediaService.cleanupFile(mp3Path)
          } catch (error) {
            logger.warn(`[${pluginName}] ${label}语音识别失败：${error.message}`)
          }
        }

        if (audioTexts.length > 0) {
          parts.push(`语音内容：${audioTexts.join(' / ')}`)
        }
      }

      try {
        const otherFileTexts = await this.summarizeOtherFiles(
          allOtherFiles,
          mediaLimits.otherMaxPerRequest,
          { previewLimit: 400 }
        )
        if (otherFileTexts.length > 0) {
          parts.push(...otherFileTexts.map(text => this.messageService.truncateContextText(text, 400)))
        }
      } catch (error) {
        logger.warn(`[${pluginName}] ${label}附件处理失败：${error.message}`)
      }

      debugLog('search.context.media', '搜索上下文媒体处理完成', {
        label,
        imageCount: allImages.length,
        videoCount: allVideos.length,
        audioCount: allAudios.length,
        otherFileCount: allOtherFiles.length,
        summaryCount: parts.length
      })

      return parts.join('\n')
    } finally {
      this.mediaService.cleanupFiles(imageFiles)
      this.mediaService.cleanupFiles(videoFiles)
      this.mediaService.cleanupFiles(audioFiles)
    }
  }

  async enrichSearchContextWithMedia(e, context = {}) {
    if (!context?.hasContext) {
      return context
    }

    if (context?.replyMessage) {
      const replyMediaSummary = await this.describeSearchContextMedia(e, context.replyMessage, '引用消息')
      if (!replyMediaSummary) {
        return context
      }

      return {
        ...context,
        replyText: [
          context.replyText,
          `[引用媒体补充] ${replyMediaSummary}`
        ].filter(Boolean).join('\n'),
        hasContext: true
      }
    }

    const historyMediaMessage = this.pickRecentMediaMessageForSearchContext(e, context)
    if (!historyMediaMessage) {
      return context
    }

    const historyMediaSummary = await this.describeSearchContextMedia(e, historyMediaMessage, '前文消息')
    if (!historyMediaSummary) {
      return context
    }

    const historyEntry = [
      await this.messageService.formatMessageForContext(e, historyMediaMessage, {
        includeMediaPlaceholders: true
      }),
      `[前文媒体补充] ${historyMediaSummary}`
    ].filter(Boolean).join('\n')

    const historyTexts = Array.isArray(context.historyTexts) ? [...context.historyTexts] : []
    historyTexts.push(historyEntry)

    debugLog('search.context.media', '无引用模式注入最近前文媒体补充', {
      injected: true,
      historyCountAfterInject: historyTexts.length,
      preview: this.messageService.truncateContextText(historyEntry, 180)
    })

    return {
      ...context,
      historyTexts,
      hasContext: true
    }
  }

  async sendResult(e, forwardMsg, fallbackText = '', htmlContent = null, funcType = '') {
    const autoFallback = Config.get('send.autoFallback', true)
    let sendMode = this.getSendMode(funcType)

    while (sendMode) {
      if (sendMode === 'html' && htmlContent) {
        try {
          const imagePath = await this.mediaService.renderHtmlToImage(htmlContent)
          if (imagePath && fs.existsSync(imagePath)) {
            await e.reply({ type: 'image', file: imagePath })
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
    const isExplicitSearch = e.msg.startsWith('搜索')
    const rawQuestion = isExplicitSearch
      ? e.msg.replace(/^搜索/, '').trim()
      : e.msg.trim()
    const keyword = isExplicitSearch
      ? rawQuestion
      : extractKeyword(e.msg)

    if (!keyword) {
      await e.reply('请输入要搜索的内容，例如：搜索胡桃')
      return true
    }

    let searchQuery = keyword
    let displayKeyword = keyword
    let searchContext = null

    try {
      const historyCount = isExplicitSearch ? 0 : Config.get('searchContext.historyMessageCount', 5)
      const replyNearbyCount = Config.get('searchContext.replyNearbyMessageCount', 6)
      const filterBotMessages = Config.get('searchContext.filterBotMessages', true)
      let context = await this.messageService.buildSearchContext(e, {
        historyCount,
        replyNearbyCount,
        filterBotMessages
      })
      context = await this.enrichSearchContextWithMedia(e, context)
      searchContext = context
      const shouldResolveIntent = context.hasContext

      if (shouldResolveIntent) {
        const resolved = await this.apiService.resolveSearchQuery(rawQuestion || keyword, context)
        searchQuery = resolved.query || searchQuery
        displayKeyword = resolved.displayKeyword || displayKeyword
      }
    } catch (error) {
      logger.warn(`[${pluginName}] 搜索意图解析失败，已回退原始关键词：${error.message}`)
    }

    return this.doSearch(e, searchQuery, {
      displayKeyword,
      rawQuestion: rawQuestion || keyword,
      searchContext
    })
  }

  async summarize(e) {
    const message = Array.isArray(e.message) ? e.message : []
    const replySegment = message.find(item => item.type === 'reply')
    const directImages = await this.messageService.extractImages(e, message)
    const directVideos = await this.messageService.extractVideos(e, message)
    const directVoices = await this.messageService.extractVoices(e, message)
    const directFiles = await this.messageService.extractFiles(e, message)
    const atMembers = this.messageService.extractAtMembers(message)

    const hasReplyOrMedia = Boolean(replySegment?.id || directImages.length > 0 || directVideos.length > 0 || directVoices.length > 0 || directFiles.length > 0)
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
      const notices = Array.isArray(cached.notices) ? cached.notices : []
      const displayText = this.buildSummaryDisplayText(result, notices)
      const html = generateHutaoHTML('内容总结', this.buildSummaryHtmlContent(result), null, notices)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${displayText}` }] }],
        `内容总结：\n\n${displayText}`,
        html,
        'contentSummary'
      )
      return true
    }

    await e.reply('正在分析内容，请稍候...')

    try {
      const orderedContextTexts = []
      const extraExtractedTexts = []
      const allImages = [...directImages]
      const allVideos = [...directVideos]
      const allAudios = [...directVoices]
      const allOtherFiles = []

      this.appendExtractedFiles(directFiles, {
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        others: allOtherFiles
      })

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
            orderedContextTexts.push(...(forwardContent.orderedTexts?.length ? forwardContent.orderedTexts : forwardContent.texts))
            allImages.push(...forwardContent.images)
            allVideos.push(...forwardContent.videos)
            allAudios.push(...(forwardContent.audios || []))
            this.appendExtractedFiles(forwardContent.files || [], {
              images: allImages,
              videos: allVideos,
              audios: allAudios,
              others: allOtherFiles
            })
          }
        }

        const replyOrderedParts = []
        for (const segmentItem of replyList) {
          const data = this.messageService.getSegmentData(segmentItem)
          const type = segmentItem?.type || data?.type || data?._type || ''

          if (type === 'text') {
            const text = data.text || segmentItem?.text || ''
            if (text.trim()) {
              replyOrderedParts.push(text.trim())
            }
          } else if (type === 'image') {
            const images = await this.messageService.extractImages(e, [segmentItem])
            allImages.push(...images)
            if (images.length > 0) {
              replyOrderedParts.push(...images.map(() => this.messageService.getSummaryPlaceholderByMediaType('image')))
            }
          } else if (type === 'video') {
            const videos = await this.messageService.extractVideos(e, [segmentItem])
            allVideos.push(...videos)
            if (videos.length > 0) {
              replyOrderedParts.push(...videos.map(() => this.messageService.getSummaryPlaceholderByMediaType('video')))
            }
          } else if (type === 'record') {
            const audios = await this.messageService.extractVoices(e, [segmentItem])
            allAudios.push(...audios)
            if (audios.length > 0) {
              replyOrderedParts.push(...audios.map(() => this.messageService.getSummaryPlaceholderByMediaType('audio')))
            }
          } else if (type === 'file') {
            const files = await this.messageService.extractFiles(e, [segmentItem])
            this.appendExtractedFiles(files, {
              images: allImages,
              videos: allVideos,
              audios: allAudios,
              others: allOtherFiles
            })
            replyOrderedParts.push(...this.messageService.getSummaryPlaceholdersFromFiles(files))
          } else if (type === 'forward') {
            this.flushOrderedSummaryParts(replyOrderedParts, orderedContextTexts)
            const forwardContent = await this.messageService.parseForwardMessage(e, segmentItem)
            orderedContextTexts.push(...(forwardContent.orderedTexts?.length ? forwardContent.orderedTexts : forwardContent.texts))
            allImages.push(...forwardContent.images)
            allVideos.push(...forwardContent.videos)
            allAudios.push(...(forwardContent.audios || []))
            this.appendExtractedFiles(forwardContent.files || [], {
              images: allImages,
              videos: allVideos,
              audios: allAudios,
              others: allOtherFiles
            })
          } else if (type === 'json') {
            try {
              const raw = data.data || segmentItem?.data || ''
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
              const resId = parsed?.meta?.detail?.resid
              if (resId) {
                this.flushOrderedSummaryParts(replyOrderedParts, orderedContextTexts)
                const forwardContent = await this.messageService.parseForwardMessage(e, { id: resId, res_id: resId })
                orderedContextTexts.push(...(forwardContent.orderedTexts?.length ? forwardContent.orderedTexts : forwardContent.texts))
                allImages.push(...forwardContent.images)
                allVideos.push(...forwardContent.videos)
                allAudios.push(...(forwardContent.audios || []))
                this.appendExtractedFiles(forwardContent.files || [], {
                  images: allImages,
                  videos: allVideos,
                  audios: allAudios,
                  others: allOtherFiles
                })
              }
            } catch {}
          }
        }

        this.flushOrderedSummaryParts(replyOrderedParts, orderedContextTexts)
      }

      if (orderedContextTexts.length === 0 && allImages.length === 0 && allVideos.length === 0 && allAudios.length === 0 && allOtherFiles.length === 0) {
        await e.reply('未能从消息中提取到可分析内容')
        return true
      }

      const fileLimits = this.getSummaryFileLimits()
      const imageFiles = await this.mediaService.downloadImages(allImages, 'sum_img', fileLimits.totalImageLimit)
      const videoFiles = await this.mediaService.downloadVideos(allVideos, 'sum_vid', fileLimits.totalVideoLimit)
      const audioFiles = await this.mediaService.downloadAudios(allAudios, 'sum_audio', fileLimits.totalAudioLimit)
      const mediaFiles = [...imageFiles, ...videoFiles]

      debugLog('summary.media', '内容总结媒体批次配置', {
        loopLimit: fileLimits.loopLimit,
        imageMaxPerRequest: fileLimits.imageMaxPerRequest,
        videoMaxPerRequest: fileLimits.videoMaxPerRequest,
        audioMaxPerRequest: fileLimits.audioMaxPerRequest,
        otherMaxPerRequest: fileLimits.otherMaxPerRequest,
        downloadedImages: imageFiles.length,
        downloadedVideos: videoFiles.length,
        downloadedAudios: audioFiles.length,
        otherFiles: allOtherFiles.length
      })

      if (audioFiles.length > 0) {
        await e.reply(`正在识别 ${audioFiles.length} 条语音内容...`)
        for (const audio of audioFiles) {
          const mp3Path = await this.mediaService.convertAudioToMp3(audio.localPath)
          const audioResult = mp3Path ? await this.apiService.callAudioAPI(mp3Path) : null
          if (audioResult) {
            extraExtractedTexts.push(`【语音内容】${audioResult}`)
          }
          this.mediaService.cleanupFile(mp3Path)
        }
        this.mediaService.cleanupFiles(audioFiles)
      }

      const otherFileTexts = await this.summarizeOtherFiles(allOtherFiles, fileLimits.totalOtherLimit)
      if (otherFileTexts.length > 0) {
        extraExtractedTexts.push(...otherFileTexts)
      }

      const botProfile = await this.messageService.getBotProfileForPrompt(e)
      const promptSections = []
      if (orderedContextTexts.length > 0) {
        promptSections.push('以下内容已尽量按原消息顺序整理；文中的[图片]、[视频]、[语音]、[附件]占位与后续上传媒体的顺序一致。若某张长图被自动裁剪，其片段也会按原图顺序连续排列。请结合上下文理解，不要打乱对应关系。')
        promptSections.push(orderedContextTexts.join('\n'))
      }
      if (extraExtractedTexts.length > 0) {
        promptSections.push(extraExtractedTexts.join('\n\n'))
      }

      const prompt = promptSections.length > 0
        ? [
            '请对以下内容进行全面分析和总结。',
            botProfile.promptText ? `机器人身份说明：\n${botProfile.promptText}` : '',
            promptSections.join('\n\n')
          ].filter(Boolean).join('\n\n')
        : [
            '请分析这些媒体内容，描述你看到的内容并进行总结。',
            botProfile.promptText ? `机器人身份说明：\n${botProfile.promptText}` : ''
          ].filter(Boolean).join('\n\n')

      const result = await this.apiService.callSummaryAPI(prompt, mediaFiles)
      this.mediaService.cleanupFiles(imageFiles)
      this.mediaService.cleanupFiles(videoFiles)
      const summaryNotices = this.buildImageOverflowNotices(imageFiles.summaryMeta, {
        processedCount: imageFiles.length,
        totalLimit: fileLimits.totalImageLimit
      })

      if (!result) {
        await e.reply('总结失败，请稍后重试')
        return true
      }

      this.setCache(cacheKey, { result, notices: summaryNotices })
      const displayText = this.buildSummaryDisplayText(result, summaryNotices)
      const html = generateHutaoHTML('内容总结', this.buildSummaryHtmlContent(result), null, summaryNotices)
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${displayText}` }] }],
        `内容总结：\n\n${displayText}`,
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
    const timeRangeHours = Math.max(0, Number(chatConfig.historyHoursLimit) || 0)
    const messageCount = Number(options.messageCountOverride)
      || (atMembers.length > 0 ? chatConfig.atMemberMessageCount : chatConfig.defaultMessageCount)
    const actualMembers = [...new Set((atMembers || []).map(String))]
    const cacheType = actualMembers.length > 0 ? 'member' : 'group'
    const cacheId = `${e.group_id}:${actualMembers.sort().join('_') || 'all'}:count:${messageCount}:hours:${timeRangeHours || 'all'}`
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
    await e.reply(
      timeRangeHours > 0
        ? `正在获取${targetText}最近 ${timeRangeHours} 小时内最多 ${messageCount} 条消息进行分析...`
        : `正在获取${targetText}最近 ${messageCount} 条消息进行分析...`
    )

    try {
      const rawMessages = await this.messageService.getGroupHistoryMessages(e, Math.min(messageCount, chatConfig.maxMessageCount || 500))
      if (!rawMessages || rawMessages.length === 0) {
        await e.reply('无法获取群聊历史消息，请确认机器人权限')
        return true
      }

      const messages = this.messageService.filterMessagesByTimeRange(rawMessages, timeRangeHours)
      if (messages.length === 0 && timeRangeHours > 0) {
        await e.reply(`最近 ${timeRangeHours} 小时内没有可分析的群消息`)
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
        if (timeRangeHours > 0) {
          await e.reply(actualMembers.length > 0
            ? `最近 ${timeRangeHours} 小时内未找到被 @ 成员的有效消息`
            : `最近 ${timeRangeHours} 小时内未能解析出有效群消息`)
        } else {
          await e.reply(actualMembers.length > 0 ? '未找到被 @ 成员的有效消息' : '未能解析出有效群消息')
        }
        return true
      }

      let imageSummary = ''
      if (allImageUrls.length > 0) {
        const fileLimits = this.getSummaryFileLimits()
        const imageFiles = await this.mediaService.downloadImages(
          allImageUrls.map(url => ({ type: 'image', url })),
          'group_img',
          fileLimits.totalImageLimit
        )

        if (imageFiles.length > 0) {
          const imageResult = await this.summarizeImageBatches(
            '请简要描述这些图片的内容，每张图片用一句话概括。',
            imageFiles,
            fileLimits.imageMaxPerRequest,
            fileLimits.loopLimit,
            '群聊图片'
          )
          if (imageResult) {
            imageSummary = `\n\n【群聊图片内容】\n${imageResult}`
          }
          this.mediaService.cleanupFiles(imageFiles)
        }
      }

      let docTexts = ''
      const fileLimits = this.getSummaryFileLimits()
      for (const doc of allDocFiles.slice(0, fileLimits.totalOtherLimit)) {
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
            if (this.isTextLikeAttachment(doc.name)) {
              const content = fs.readFileSync(localPath, 'utf8')
              const limit = chatConfig.docMaxChars || 2000
              const truncated = content.slice(0, limit)
              docTexts += `\n\n【文档: ${doc.name}】\n${truncated}${content.length > limit ? '...(已截断)' : ''}`
            } else {
              const ext = this.messageService.getFileExtension(doc.name, docUrl)
              if (['doc', 'docx', 'pdf'].includes(ext)) {
                docTexts += `\n\n【文档: ${doc.name}】当前版本暂不直接提取 Word/PDF 正文或内嵌图片，请结合文件名和聊天上下文理解其主题`
              } else {
                docTexts += `\n\n【文档: ${doc.name}】已检测到附件，但当前仅支持直接提取文本类文件内容`
              }
            }
            this.mediaService.cleanupFile(localPath)
          }
        } catch {}
      }

      const sortedMembers = Object.entries(userMessageCounts).sort((a, b) => b[1] - a[1])
      const statsText = sortedMembers.slice(0, 10).map(([name, count]) => `${name}: ${count}条`).join('、')
      const botProfile = await this.messageService.getBotProfileForPrompt(e)
      const messageTexts = formattedMessages
        .map(item => {
          const isBotMessage = botProfile.userId && String(item.user_id || '') === botProfile.userId
          const senderName = isBotMessage ? '我(机器人)' : item.nickname
          return `[${item.time}] ${senderName}: ${item.text}`
        })
        .join('\n')
      const memberProfilesText = actualMembers.length > 0
        ? await this.messageService.getGroupMemberProfiles(e, actualMembers)
        : ''
      const promptTemplate = actualMembers.length > 0
        ? Config.get('prompt.groupMember', '')
        : Config.get('prompt.groupChat', '')
      let extraContext = `${imageSummary}${docTexts}`

      if (memberProfilesText && !promptTemplate.includes('{memberProfiles}')) {
        extraContext += `\n\n【目标成员主页资料】\n${memberProfilesText}`
      }

      if (botProfile.promptText && !promptTemplate.includes('{botProfile}')) {
        extraContext += `\n\n【机器人身份】\n${botProfile.promptText}`
      }

      const prompt = promptTemplate
        .replace('{statsText}', statsText)
        .replace('{extraContext}', extraContext)
        .replace('{memberProfiles}', memberProfilesText || '无')
        .replace('{botProfile}', botProfile.promptText || '无')
        .replace('{messageTexts}', messageTexts)

      const result = await this.apiService.callSummaryTextAPI(prompt)
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

  async doSearch(e, searchQuery, options = {}) {
    const displayKeyword = options.displayKeyword || searchQuery
    const rawQuestion = options.rawQuestion || displayKeyword
    const searchContext = options.searchContext?.hasContext ? options.searchContext : null
    const userInfo = this.messageService.getUserInfo(e)
    const cacheKey = this.getCacheKey('search', searchQuery)
    const cached = this.tryGetCache(cacheKey, '搜索')
    let data = searchContext ? null : cached?.data || null
    let citations = cached?.citations || []
    let rawContent = cached?.rawContent || ''
    const screenshotPaths = []

    if (!rawContent) {
      try {
        const searchResult = await this.apiService.searchKeyword(searchQuery)
        if (!searchResult.content) {
          await e.reply(`未找到“${displayKeyword}”的相关信息`)
          return true
        }

        citations = searchResult.citations || []
        rawContent = searchResult.content
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

    if (!data) {
      try {
        data = await this.apiService.organizeSearchResult(displayKeyword, rawContent, {
          question: rawQuestion,
          context: searchContext
        })

        if (!data?.详细信息 && !data?.总结) {
          data = { 内容: rawContent }
        }

        this.setCache(cacheKey, {
          data: searchContext ? (cached?.data || null) : data,
          citations,
          rawContent
        })
      } catch (error) {
        if (error.name === 'AbortError') {
          await e.reply('查询超时，请稍后重试')
        } else {
          logger.error(`[${pluginName}] 搜索结果整理失败`, error)
          await e.reply('查询失败，请稍后重试')
        }
        return true
      }
    }

    try {
      const forwardMsg = []
      const contentText = this.buildSearchContent(data, rawContent)

      if (contentText) {
        forwardMsg.push({
          ...userInfo,
          message: [{ type: 'text', text: `═══ ${displayKeyword} ═══\n\n${contentText}` }]
        })
      }

      if (citations.length > 0) {
        forwardMsg.push({
          ...userInfo,
          message: [{
            type: 'text',
            text: `═══ ${displayKeyword} - 参考来源 ═══\n\n${citations.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
          }]
        })

        const screenshotCount = Config.get('send.searchScreenshotCount', -1)
        if (screenshotCount !== 0) {
          const mode = Config.get('send.searchScreenshotMode', 'viewport')
          const timeoutMs = Config.get('send.searchScreenshotTimeoutMs', 10000)
          const limit = screenshotCount === -1 ? citations.length : Math.min(citations.length, screenshotCount)
          const targets = citations.slice(0, limit)

          for (let index = 0; index < targets.length; index += 1) {
            const screenshot = await this.mediaService.captureScreenshot(targets[index], index, mode, {
              timeoutMs
            })
            if (screenshot && fs.existsSync(screenshot)) {
              screenshotPaths.push(screenshot)
              forwardMsg.push({
                ...userInfo,
                message: [
                  { type: 'text', text: `来源 ${index + 1}: ${targets[index]}` },
                  { type: 'image', file: screenshot }
                ]
              })
            }
          }
        }
      }

      const html = generateSearchHTML(displayKeyword, contentText, citations)
      await this.sendResult(
        e,
        forwardMsg,
        contentText || '查询完成',
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

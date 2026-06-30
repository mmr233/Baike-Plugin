import fs from 'node:fs'
import Config from '../Config.js'
import resultCache from '../cache.js'
import { debugLog } from '../debug.js'
import { pluginName } from '../constant.js'
import ApiService from './apiService.js'
import DocumentService from './documentService.js'
import MediaService from './mediaService.js'
import MessageService from './messageService.js'
import SummaryBillingService from './summaryBillingService.js'
import { beautifyText, extractKeyword, formatDetailValue, parseSummaryContent } from '../../utils/text.js'
import { generateGroupSummaryHTML, generateHutaoHTML, generateSearchHTML } from '../../utils/html.js'

const SEND_MODE_PRIORITY = ['html', 'forward', 'text']
const DEFAULT_GROUP_SUMMARY_INFLIGHT_WAIT_MS = 120000

function getSendErrorText(error = {}) {
  return [
    error?.message,
    error?.wording,
    error?.raw,
    error?.error?.message,
    error?.error?.wording,
    error?.error?.raw,
    error?.cause?.message
  ].filter(Boolean).join('\n')
}

function getBriefSendError(error = {}) {
  const text = getSendErrorText(error) || String(error || '')
  return text.split('\n').find(Boolean) || '未知错误'
}

function isAmbiguousSendTimeoutError(error = {}) {
  const text = getSendErrorText(error)
  const retcode = Number(error?.retcode ?? error?.error?.retcode)
  const action = String(error?.action || error?.error?.action || '')

  return (
    (action === 'send_msg' || /sendMsg|send_msg/i.test(text)) &&
    (retcode === 1200 || /Timeout/i.test(text)) &&
    /NodeIKernelMsgService\/sendMsg|onMsgInfoListUpdate|NTEvent/i.test(text)
  )
}

class BaikeService {
  constructor() {
    this.apiService = new ApiService()
    this.mediaService = new MediaService()
    this.messageService = new MessageService()
    this.documentService = new DocumentService(this.mediaService, this.messageService)
    this.summaryBillingService = new SummaryBillingService()
    this.searchBillingService = new SummaryBillingService({
      configKey: 'searchBilling',
      featureName: '搜索',
      logScope: 'search.billing',
      serviceKey: 'search',
      defaultItemId: 'baike:search_service',
      defaultItemName: '百科搜索服务',
      defaultItemAliases: ['搜索', '百科搜索', '查询', '百科查询'],
      defaultCostFavor: 2,
      type: 'baike:search_service',
      typeLabel: '百科搜索服务',
      typeSubtitle: '使用百科搜索时自动扣费',
      typeIntro: '这是 Baike-Plugin 的服务型商品，触发搜索并实际消耗模型时会自动扣除好感度。',
      ownedText: '服务型商品，使用搜索时自动扣除',
      defaultFeature: 'search',
      chargeSourcePrefix: 'search',
      refundSourcePrefix: 'search-refund',
      defaultFailureReason: 'search_failed',
      usageDataFile: 'search_billing_usage.json',
      limitExceededCode: 'search_usage_limit_exceeded',
      unavailableItemMessage: '未找到搜索计费商品，请联系主人检查 Iris 商城配置',
      platformDisabledMessage: '签到插件当前已关闭，暂时无法使用搜索计费服务',
      registrationDisabledMessage: '搜索计费未启用',
      typeRegisterFailedMessage: '搜索计费商品类型注册失败',
      itemRegisterFailedMessage: '搜索计费商品注册失败',
      desc: 'Baike-Plugin 搜索功能自动扣费项；可在 Iris-Sign-Plugin 的商城配置中用同 ID 覆盖价格。'
    })
    this.groupSummaryInflight = new Map()
    this.summaryBillingService.ensureRegistered()
      .catch(error => logger.warn(`[${pluginName}] 总结计费商品预注册失败：${error.message}`))
    this.searchBillingService.ensureRegistered()
      .catch(error => logger.warn(`[${pluginName}] 搜索计费商品预注册失败：${error.message}`))
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

  getGroupSummaryInflightConfig() {
    const chatConfig = Config.get('chatSummary', {})
    const inflight = chatConfig.inflightDedup || chatConfig.pendingDedup || {}
    const waitMs = Number(inflight.waitMs)
    const waitMinutes = Number(inflight.waitMinutes)
    const waitSeconds = Number(inflight.waitSeconds)
    const resolvedWaitMs = Number.isFinite(waitMs) && waitMs >= 0
      ? waitMs
      : Number.isFinite(waitMinutes) && waitMinutes >= 0
        ? waitMinutes * 60 * 1000
        : Number.isFinite(waitSeconds) && waitSeconds >= 0
          ? waitSeconds * 1000
          : DEFAULT_GROUP_SUMMARY_INFLIGHT_WAIT_MS

    return {
      enabled: inflight.enabled !== false,
      waitMs: Math.max(0, Math.floor(resolvedWaitMs))
    }
  }

  waitForPromiseWithTimeout(promise, timeoutMs) {
    if (!promise || timeoutMs <= 0) {
      return Promise.resolve({ timedOut: true })
    }

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        resolve({ timedOut: true })
      }, timeoutMs)

      promise
        .then(value => {
          clearTimeout(timer)
          resolve({ timedOut: false, value })
        })
        .catch(error => {
          clearTimeout(timer)
          resolve({ timedOut: false, error })
        })
    })
  }

  createDeferred() {
    let resolve
    const promise = new Promise(innerResolve => {
      resolve = innerResolve
    })
    return { promise, resolve }
  }

  registerGroupSummaryInflight(cacheKey, meta = {}) {
    const config = this.getGroupSummaryInflightConfig()
    if (!config.enabled || config.waitMs <= 0) {
      return null
    }

    const deferred = this.createDeferred()
    const entry = {
      ...deferred,
      cacheKey,
      createdAt: Date.now(),
      waitMs: config.waitMs,
      meta
    }
    this.groupSummaryInflight.set(cacheKey, entry)
    return entry
  }

  finishGroupSummaryInflight(cacheKey, entry, result = {}) {
    if (!entry) {
      return
    }

    if (this.groupSummaryInflight.get(cacheKey) === entry) {
      this.groupSummaryInflight.delete(cacheKey)
    }

    entry.resolve(result)
  }

  getActiveGroupSummaryInflight(cacheKey) {
    const config = this.getGroupSummaryInflightConfig()
    if (!config.enabled || config.waitMs <= 0) {
      return null
    }

    const entry = this.groupSummaryInflight.get(cacheKey)
    if (!entry) {
      return null
    }

    const ageMs = Date.now() - Number(entry.createdAt || 0)
    if (ageMs > config.waitMs) {
      this.groupSummaryInflight.delete(cacheKey)
      return null
    }

    return entry
  }

  async sendCachedGroupSummary(e, cached, options = {}) {
    const chargeResult = await this.chargeSummaryUsage(e, {
      feature: cached.isMemberMode ? 'memberSummary' : 'groupChatSummary',
      cacheHit: true,
      skipBilling: options.skipBilling
    })
    if (!chargeResult) {
      return true
    }

    const parsed = parseSummaryContent(cached.result)
    const userInfo = this.messageService.getUserInfo(e)
    const billingText = this.buildSummaryBillingText(chargeResult, e)
    const fallbackText = this.appendSummaryBillingText(`${cached.title}：\n\n${cached.result}`, billingText)
    const forwardText = this.appendSummaryBillingText(
      `═══ ${cached.title} ═══\n\n📊 消息数量：${cached.statsData.messageCount}条\n👥 活跃成员：${cached.statsData.memberCount}人\n📈 发言排行：${cached.statsData.statsText}\n\n═══ 内容分析 ═══\n\n${cached.result}`,
      billingText
    )
    try {
      await this.sendResult(
        e,
        [{
          ...userInfo,
          message: [{
            type: 'text',
            text: forwardText
          }]
        }],
        fallbackText,
        generateGroupSummaryHTML(cached.title, parsed, {
          ...cached.statsData,
          isMemberMode: cached.isMemberMode,
          billingText
        }),
        cached.isMemberMode ? 'memberSummary' : 'groupChatSummary'
      )
      await this.completeSummaryUsage(chargeResult, options.completedReason || 'cached_group_summary_sent')
    } catch (error) {
      await this.refundSummaryUsage(chargeResult, options.failedReason || 'cached_group_summary_send_failed')
      throw error
    }

    return true
  }

  async waitForGroupSummaryCache(e, cacheKey, moduleName, options = {}) {
    const entry = this.getActiveGroupSummaryInflight(cacheKey)
    if (!entry) {
      return false
    }

    const waitMs = Math.max(0, Math.min(Number(entry.waitMs) || 0, this.getGroupSummaryInflightConfig().waitMs))
    const waitResult = await this.waitForPromiseWithTimeout(entry.promise, waitMs)
    if (waitResult.timedOut) {
      debugLog('summary.groupInflight', '群聊总结在途等待超时，转为独立处理', {
        cacheKey,
        waitMs
      })
      return false
    }

    const cached = this.tryGetCache(cacheKey, moduleName)
    if (cached?.result) {
      debugLog('summary.groupInflight', '群聊总结等待完成，已复用缓存发送', {
        cacheKey,
        waitMs
      })
      await this.sendCachedGroupSummary(e, cached, {
        ...options,
        completedReason: 'waited_group_summary_cache_sent',
        failedReason: 'waited_group_summary_cache_send_failed'
      })
      return true
    }

    if (waitResult.error) {
      debugLog('summary.groupInflight', '群聊总结在途任务失败，转为独立处理', {
        cacheKey,
        error: waitResult.error.message
      })
    }

    return false
  }

  async mapWithConcurrency(items = [], limit = 2, handler = async item => item) {
    const actualLimit = Math.max(1, Math.min(Number(limit) || 1, items.length || 1))
    const results = new Array(items.length)
    let nextIndex = 0

    const worker = async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1

        try {
          results[currentIndex] = await handler(items[currentIndex], currentIndex)
        } catch (error) {
          results[currentIndex] = { error }
        }
      }
    }

    await Promise.all(Array.from({ length: actualLimit }, worker))
    return results
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

  getSearchSourceDisplay(citations = []) {
    const items = Array.isArray(citations) ? citations.filter(Boolean) : []
    const rawLimit = Number(Config.get('send.searchSourceDisplayLimit', 10))
    const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 10

    if (limit === 0) {
      return {
        citations: [],
        hiddenCount: items.length,
        sourceCount: items.length,
        disabled: true
      }
    }

    const visible = limit < 0 ? items : items.slice(0, limit)
    return {
      citations: visible,
      hiddenCount: Math.max(0, items.length - visible.length),
      sourceCount: items.length,
      disabled: false
    }
  }

  buildSearchSourceText(displayKeyword = '', citations = [], hiddenCount = 0) {
    if (!Array.isArray(citations) || citations.length === 0) {
      return ''
    }

    const lines = citations.map((item, index) => `${index + 1}. ${item}`)
    if (hiddenCount > 0) {
      lines.push(`……已隐藏 ${hiddenCount} 个参考来源，可在锅巴调整“搜索来源显示上限”。`)
    }

    return `═══ ${displayKeyword} - 参考来源 ═══\n\n${lines.join('\n')}`
  }

  shouldQuoteReply(e = {}) {
    return Boolean(e?.message_id)
  }

  async replyResult(e, message, label = '结果', quote = false) {
    try {
      if (quote) {
        await e.reply(message, true)
      } else {
        await e.reply(message)
      }
      return true
    } catch (error) {
      if (isAmbiguousSendTimeoutError(error)) {
        logger.warn(`[${pluginName}] ${label}发送回执超时，消息可能已成功送达，已停止自动降级：${getBriefSendError(error)}`)
        return true
      }

      throw error
    }
  }

  getBillingUserLabel(e = {}, chargeResult = null) {
    const userId = String(chargeResult?.userId || e?.user_id || '').trim()
    const name = String(e?.sender?.card || e?.sender?.nickname || chargeResult?.userName || '').trim()

    if (name && userId && name !== userId) {
      return `${name}(${userId})`
    }

    return name || userId || ''
  }

  async chargeSummaryUsage(e, context = {}) {
    const result = await this.summaryBillingService.charge(e, context)
    if (!result.ok) {
      await e.reply(result.message || '好感度不足，暂时无法使用总结功能')
      return null
    }

    return result
  }

  async refundSummaryUsage(chargeResult, reason = 'summary_failed') {
    try {
      await this.summaryBillingService.refund(chargeResult, reason)
    } catch (error) {
      logger.warn(`[${pluginName}] 总结计费退款处理失败：${error.message}`)
    }
  }

  async completeSummaryUsage(chargeResult, reason = 'summary_completed') {
    try {
      await this.summaryBillingService.complete(chargeResult, reason)
    } catch (error) {
      logger.warn(`[${pluginName}] 总结次数记录完成处理失败：${error.message}`)
    }
  }

  async chargeSearchUsage(e, context = {}) {
    const result = await this.searchBillingService.charge(e, context)
    if (!result.ok) {
      await e.reply(result.message || '好感度不足，暂时无法使用搜索功能')
      return null
    }

    return result
  }

  async refundSearchUsage(chargeResult, reason = 'search_failed') {
    try {
      await this.searchBillingService.refund(chargeResult, reason)
    } catch (error) {
      logger.warn(`[${pluginName}] 搜索计费退款处理失败：${error.message}`)
    }
  }

  async completeSearchUsage(chargeResult, reason = 'search_completed') {
    try {
      await this.searchBillingService.complete(chargeResult, reason)
    } catch (error) {
      logger.warn(`[${pluginName}] 搜索次数记录完成处理失败：${error.message}`)
    }
  }

  getBillingReasonText(reason = '') {
    const reasonMap = {
      cacheHit: '命中缓存',
      master: '主人免计费',
      skipBilling: '已跳过计费',
      missingContext: '缺少群聊或用户上下文',
      disabled: '计费未启用',
      free: '商品价格为 0',
      shop_unavailable: '商城不可用放行',
      platform_disabled: 'Iris 总开关关闭放行',
      item_disabled: '商品未开放放行'
    }
    return reasonMap[reason] || reason || '未扣费'
  }

  buildBillingText(chargeResult = null, fallbackItemName = '百科服务', e = {}) {
    if (!chargeResult) {
      return ''
    }

    const itemName = chargeResult.item?.name || fallbackItemName
    const userLabel = this.getBillingUserLabel(e, chargeResult)
    const userLine = userLabel ? `使用者：${userLabel}。` : ''
    if (chargeResult.charged) {
      const parts = [userLine, `本次${itemName}已扣除 ${chargeResult.costFavor || 0} 点好感度。`].filter(Boolean)
      if (chargeResult.beforeFavor !== undefined && chargeResult.favor !== undefined) {
        parts.push(`扣费前：${chargeResult.beforeFavor}，扣费后：${chargeResult.favor}。`)
      } else if (chargeResult.favor !== undefined) {
        parts.push(`当前好感度：${chargeResult.favor}。`)
      }
      return parts.join('\n')
    }

    if (chargeResult.skipped || chargeResult.reason) {
      return [userLine, `本次未扣好感度：${this.getBillingReasonText(chargeResult.reason)}。`].filter(Boolean).join('\n')
    }

    return ''
  }

  buildSummaryBillingText(chargeResult = null, e = {}) {
    return this.buildBillingText(chargeResult, '百科总结服务', e)
  }

  buildSearchBillingText(chargeResult = null, e = {}) {
    return this.buildBillingText(chargeResult, '百科搜索服务', e)
  }

  appendBillingText(text = '', billingText = '') {
    const actualText = String(text || '').trim()
    const actualBillingText = String(billingText || '').trim()
    if (!actualBillingText) {
      return actualText
    }

    return [
      actualText,
      `【扣费信息】\n${actualBillingText}`
    ].filter(Boolean).join('\n\n')
  }

  appendSummaryBillingText(text = '', billingText = '') {
    return this.appendBillingText(text, billingText)
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

  async resolveAttachmentUrl(file = {}, e = null) {
    if (file?.url) {
      return file.url
    }

    if (!file?.file_id || !e?.bot?.sendApi) {
      return ''
    }

    try {
      const fileInfo = await e.bot.sendApi('get_file', { file_id: file.file_id })
      return this.messageService.getUsableFileInfoSource(fileInfo)
    } catch {
      try {
        const fileInfo = await e.bot.sendApi('get_file', { file: file.file_id })
        return this.messageService.getUsableFileInfoSource(fileInfo)
      } catch {
        return ''
      }
    }
  }

  async summarizeAttachmentImages(fileName = '', images = [], options = {}) {
    if (!Array.isArray(images) || images.length === 0) {
      return ''
    }

    const batchLimit = Math.max(0, Number(options.batchLimit) || this.getSummaryFileLimits().imageMaxPerRequest)
    if (batchLimit <= 0) {
      return ''
    }

    const totalBatches = Math.ceil(images.length / batchLimit)
    const kindLabel = options.kind === 'pdf' ? 'PDF 页面截图' : '文档内嵌图片'
    const results = []

    for (let batch = 0; batch < totalBatches; batch += 1) {
      const chunk = images.slice(batch * batchLimit, (batch + 1) * batchLimit)
      const prompt = [
        `这些图片来自附件《${fileName}》的${kindLabel}。`,
        totalBatches > 1 ? `这是第 ${batch + 1} / ${totalBatches} 批。` : '',
        options.kind === 'pdf'
          ? '请按页码顺序提取标题、正文要点、图表、插图、截图文字和页面之间的承接关系。'
          : '请按图片顺序提取标题、正文要点、图表、插图、截图文字，以及它们和正文内容的关系。',
        '直接输出纯文本，不要使用 markdown，不要编造。'
      ].filter(Boolean).join('\n')

      const result = await this.apiService.callImageAPI(
        prompt,
        chunk,
        '你是一个文档图片理解助手。请提取有助于最终总结的关键信息，保留图片顺序，优先识别标题、正文、表格、图表、人物、场景和截图文字。直接输出简洁中文，不要使用 markdown，不要编造。'
      )

      if (result) {
        results.push(totalBatches > 1 ? `【第${batch + 1}批附件图片】\n${result}` : result)
      }
    }

    return results.join('\n\n')
  }

  async summarizeResolvedAttachment(file = {}, localPath = '', options = {}) {
    const name = String(file?.name || 'file').trim() || 'file'
    const previewLimit = Math.max(100, Number(options.previewLimit) || this.getOtherAttachmentPreviewLimit())
    const documentConfig = this.documentService.getProcessingConfig()
    const imageMaxPerFile = Math.max(
      0,
      Number(options.imageMaxPerFile ?? documentConfig.documentImageMaxPerFile) || 0
    )
    const pageLimit = Math.max(
      1,
      Number(options.pageLimit ?? documentConfig.documentPageMaxPerFile) || documentConfig.documentPageMaxPerFile
    )
    const sections = []
    let extracted = null

    try {
      extracted = await this.documentService.extractAttachment(localPath, name, {
        textLimit: previewLimit,
        imageLimit: imageMaxPerFile,
        pageLimit
      })

      const textResult = extracted?.textResult || { text: '', truncated: false, isEmpty: true }
      if (textResult.text) {
        sections.push(`【附件:${name}】\n${textResult.text}${textResult.truncated ? '\n...(已截断)' : ''}`)
      } else if (extracted?.kind === 'text') {
        sections.push(`【附件:${name}】文件内容为空`)
      }

      if (Array.isArray(extracted?.images) && extracted.images.length > 0) {
        const imageSummary = await this.summarizeAttachmentImages(name, extracted.images, {
          kind: extracted.kind,
          batchLimit: options.imageBatchLimit
        })

        if (imageSummary) {
          sections.push(`【附件配图:${name}】\n${imageSummary}`)
        } else {
          sections.push(`【附件处理说明:${name}】已提取到文档图片，但当前图片分析上限为 0`)
        }
      }

      if (Array.isArray(extracted?.notes) && extracted.notes.length > 0) {
        sections.push(`【附件处理说明:${name}】${extracted.notes.join('；')}`)
      }

      if (sections.length === 0) {
        sections.push(`【附件:${name}】未提取到可用内容`)
      }
    } finally {
      if (Array.isArray(extracted?.images) && extracted.images.length > 0) {
        this.mediaService.cleanupFiles(extracted.images)
      }
    }

    return sections
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

  getSummaryMediaTypeName(type = '') {
    if (type === 'image') {
      return '图片'
    }
    if (type === 'video') {
      return '视频'
    }
    if (type === 'audio') {
      return '语音'
    }
    return '附件'
  }

  assignSummaryMediaLabels(containers = {}) {
    const assignType = (items = [], type = '') => {
      for (const item of items || []) {
        if (item && typeof item === 'object') {
          item.summaryMediaType = type
        }
      }
    }

    assignType(containers.images, 'image')
    assignType(containers.videos, 'video')
    assignType(containers.audios, 'audio')
    assignType(containers.others, 'other')
  }

  createSummaryMediaLabelAssigner(containers = {}) {
    let index = 0
    const queues = {
      image: [...(containers.images || [])],
      video: [...(containers.videos || [])],
      audio: [...(containers.audios || [])],
      other: [...(containers.others || [])]
    }
    const ensureLabel = (item, type) => {
      if (!item || typeof item !== 'object') {
        return ''
      }

      if (!item.summaryMediaLabel) {
        index += 1
        item.summaryMediaId = `M${index}`
        item.summaryMediaType = type || item.summaryMediaType || 'other'
        item.summaryMediaLabel = `[${item.summaryMediaId} ${this.getSummaryMediaTypeName(item.summaryMediaType)}]`
      }

      return item.summaryMediaLabel
    }
    const nextLabel = (type, fallback) => {
      const item = queues[type]?.shift()
      return ensureLabel(item, type) || fallback
    }
    const assignRemaining = () => {
      for (const [type, items] of Object.entries(queues)) {
        for (const item of items) {
          ensureLabel(item, type)
        }
      }
    }

    return { ensureLabel, nextLabel, assignRemaining }
  }

  ensureFallbackSummaryMediaLabels(containers = {}) {
    const assigner = this.createSummaryMediaLabelAssigner(containers)
    assigner.assignRemaining()
  }

  relabelSummaryMediaPlaceholders(texts = [], containers = {}, assigner = null) {
    const actualAssigner = assigner || this.createSummaryMediaLabelAssigner(containers)
    const getTypeFromPlaceholder = match => {
      if (match.startsWith('[图片')) {
        return 'image'
      }
      if (match.startsWith('[视频')) {
        return 'video'
      }
      if (match.startsWith('[语音')) {
        return 'audio'
      }
      return 'other'
    }

    return (texts || []).map(text => String(text || '')
      .replace(/\[(?:图片|视频|语音|附件(?::[^\]]+)?)\]/g, match => {
        const type = getTypeFromPlaceholder(match)
        return actualAssigner.nextLabel(type, match)
      }))
  }

  buildDirectMediaTimeline(message = [], containers = {}, assigner = null) {
    const actualAssigner = assigner || this.createSummaryMediaLabelAssigner(containers)
    const queues = {
      image: [...(containers.images || [])],
      video: [...(containers.videos || [])],
      audio: [...(containers.audios || [])],
      other: [...(containers.others || [])]
    }
    const parts = []
    const nextLabel = (type, fallback) => actualAssigner.ensureLabel(queues[type]?.shift(), type) || fallback

    for (const segmentItem of message || []) {
      const data = this.messageService.getSegmentData(segmentItem)
      const type = segmentItem?.type || data?.type || data?._type || ''

      if (type === 'reply') {
        continue
      }

      if (type === 'text') {
        const text = String(data.text || segmentItem?.text || '').trim()
        const cleaned = text.replace(/^总结\s*/, '').trim()
        if (cleaned) {
          parts.push(cleaned)
        }
      } else if (type === 'image') {
        parts.push(nextLabel('image', '[图片]'))
      } else if (type === 'video') {
        parts.push(nextLabel('video', '[视频]'))
      } else if (type === 'record') {
        parts.push(nextLabel('audio', '[语音]'))
      } else if (type === 'file') {
        parts.push(nextLabel('other', '[附件]'))
      }
    }

    return parts.length > 0 ? `直接消息：${parts.join(' ')}` : ''
  }

  assignUnusedSummaryMediaLabels(containers = {}, assigner = null) {
    if (assigner) {
      assigner.assignRemaining()
      return
    }

    this.ensureFallbackSummaryMediaLabels(containers)
  }

  buildMediaProcessingNotices(imageMeta = {}, videoMeta = {}, options = {}) {
    const notices = this.buildImageOverflowNotices(imageMeta, {
      processedCount: options.processedImageCount,
      totalLimit: options.totalImageLimit
    })
    const skippedVideoSourceCount = Math.max(0, Number(videoMeta?.skippedSourceCount) || 0)
    const skippedVideoSegmentCount = Math.max(0, Number(videoMeta?.skippedSegmentCount) || 0)
    const processedVideoCount = Math.max(0, Number(options.processedVideoCount) || 0)
    const totalVideoLimit = Math.max(0, Number(options.totalVideoLimit) || 0)

    if (skippedVideoSourceCount > 0 || skippedVideoSegmentCount > 0) {
      const detailParts = []
      if (skippedVideoSourceCount > 0) {
        detailParts.push(`${skippedVideoSourceCount} 个原始视频未送入模型`)
      }
      if (skippedVideoSegmentCount > 0) {
        detailParts.push(`${skippedVideoSegmentCount} 个视频片段被截断`)
      }

      notices.push(
        `视频数量超过处理上限，本次仅分析前 ${processedVideoCount} 段${totalVideoLimit > 0 ? `（上限 ${totalVideoLimit} 段）` : ''}；${detailParts.join('，')}。`
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
    const event = options.event || null
    const includeLimitNote = options.includeLimitNote !== false
    const targets = otherFiles.slice(0, actualLimit)

    for (let index = 0; index < targets.length; index += 1) {
      const file = targets[index]
      const resolvedUrl = await this.resolveAttachmentUrl(file, event)

      const localPath = await this.mediaService.downloadFile(
        resolvedUrl,
        `sum_other_${Date.now()}_${index}_${this.sanitizeFilename(file.name)}`
      )

      if (!localPath) {
        texts.push(`【附件:${file.name}】下载失败，无法提取内容`)
        continue
      }

      try {
        const sections = await this.summarizeResolvedAttachment(
          { ...file, url: resolvedUrl },
          localPath,
          {
            previewLimit,
            imageMaxPerFile: options.imageMaxPerFile,
            pageLimit: options.pageLimit,
            imageBatchLimit: options.imageBatchLimit
          }
        )
        texts.push(...sections)
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
      try {
        const result = await this.apiService.callImageAPI(prompt, chunk)
        if (result) {
          results.push(actualBatches > 1 ? `【第${batch + 1}批${label}】\n${result}` : result)
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 第 ${batch + 1} 批${label}分析失败，已继续处理其他内容：${error.message}`)
        results.push(
          actualBatches > 1
            ? `【第${batch + 1}批${label}处理说明】该批${label}分析失败：${error.message}`
            : `【${label}处理说明】${label}分析失败：${error.message}`
        )
      }
    }

    return results.join('\n\n')
  }

  buildRuleBasedGroupSummary(options = {}) {
    const {
      formattedMessages = [],
      sortedMembers = [],
      statsText = '',
      imageSummary = '',
      docTexts = '',
      error = null,
      isMemberMode = false
    } = options
    const topicLines = [
      '模型接口当前连续连接失败，本次先给出基于群聊记录的规则摘要。',
      `共读取到 ${formattedMessages.length} 条有效消息，活跃成员 ${sortedMembers.length} 人。`,
      statsText ? `发言排行：${statsText}` : ''
    ].filter(Boolean)

    const extraContext = [imageSummary, docTexts].filter(Boolean).join('\n\n').trim()
    if (extraContext) {
      topicLines.push('媒体和附件内容已尽量提取，详见下方补充信息。')
    }

    const selectedMessages = formattedMessages
      .filter(item => String(item?.text || '').trim())
      .slice(-5)
      .reverse()

    const highlightText = selectedMessages.length > 0
      ? selectedMessages.map(item => [
          `【时间】${item.time || '未知时间'}`,
          `【发送者】${item.nickname || item.user_id || '未知成员'}`,
          `【内容】${String(item.text || '').slice(0, 180)}`,
          '【吐槽】模型接口临时掉线，先按最近消息挑出来给你保底看。'
        ].join('\n')).join('\n---\n')
      : [
          '【时间】无',
          '【发送者】系统',
          '【内容】未能提取到可展示的消息精选',
          '【吐槽】这次接口和消息都不给面子，只能诚实摆烂。'
        ].join('\n')

    const failureReasonText = error
      ? (this.apiService.formatErrorWithCause?.(error) || error.message || error)
      : ''
    const failureReason = failureReasonText
      ? `\n\n【接口处理说明】最终${isMemberMode ? '成员' : '群聊'}总结模型请求失败，已降级为规则摘要：${failureReasonText}`
      : ''
    const extraSection = extraContext ? `\n\n${extraContext}` : ''

    return [
      '===话题总结===',
      topicLines.join('\n'),
      failureReason,
      extraSection,
      '',
      '===消息精选===',
      highlightText
    ].join('\n').replace(/\n{3,}/g, '\n\n')
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
        const fileLimits = this.getSummaryFileLimits()

        try {
          videoFiles = await this.mediaService.downloadVideos(
            allVideos,
            'ctx_vid',
            mediaLimits.videoMaxPerRequest,
            {
              timeoutMs: 15000,
              maxPreparedCount: Math.max(mediaLimits.videoMaxPerRequest, fileLimits.totalVideoLimit)
            }
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
          {
            previewLimit: 400,
            event: e,
            imageMaxPerFile: mediaLimits.imageMaxPerRequest,
            imageBatchLimit: mediaLimits.imageMaxPerRequest
          }
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
        let imagePath = ''
        try {
          imagePath = await this.mediaService.renderHtmlToImage(htmlContent)
          if (imagePath && fs.existsSync(imagePath)) {
            await this.replyResult(e, { type: 'image', file: imagePath }, 'HTML 图片', this.shouldQuoteReply(e))
            return true
          }
        } catch (error) {
          logger.warn(`[${pluginName}] HTML 发送失败：${getBriefSendError(error)}`)
        } finally {
          if (imagePath) {
            this.mediaService.cleanupFile(imagePath, 5000)
          }
        }
      } else if (sendMode === 'forward' && Array.isArray(forwardMsg) && forwardMsg.length > 0) {
        try {
          const forward = Bot?.makeForwardMsg ? await Bot.makeForwardMsg(forwardMsg) : null
          if (forward) {
            await this.replyResult(e, forward, '合并转发')
            return true
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 合并转发失败：${getBriefSendError(error)}`)
        }
      } else if (sendMode === 'text') {
        if (Array.isArray(forwardMsg) && forwardMsg.length > 0) {
          for (const item of forwardMsg) {
            for (const message of item.message || []) {
              if (message.type === 'text' && message.text) {
                await this.replyResult(e, message.text, '文本结果')
              } else if (message.type === 'image' && message.file) {
                await this.replyResult(e, { type: 'image', file: message.file }, '图片结果')
              }
            }
          }
          return true
        }

        if (fallbackText) {
          await this.replyResult(e, fallbackText, '文本结果')
          return true
        }
      }

      if (!autoFallback) {
        break
      }

      sendMode = this.getNextFallbackMode(sendMode)
    }

    if (fallbackText) {
      await this.replyResult(e, fallbackText, '文本结果')
      return true
    }

    return false
  }

  async search(e) {
    const isExplicitSearch = e.msg.startsWith('搜索')
    if (!isExplicitSearch && !Config.get('searchContext.enableConvenientCommand', false)) {
      return false
    }

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

    const message = Array.isArray(e.message) ? e.message : []
    const hasReplyContext = Boolean(message.find(item => item.type === 'reply')?.id || e.reply_id)
    const initialCacheKey = this.getCacheKey('search', keyword)
    const initialCached = isExplicitSearch ? this.tryGetCache(initialCacheKey, '搜索') : null
    const initialCacheReady = Boolean(!hasReplyContext && initialCached?.rawContent && initialCached?.data)
    let chargeResult = null
    if (!initialCacheReady) {
      chargeResult = await this.chargeSearchUsage(e, {
        feature: isExplicitSearch ? 'explicitSearch' : 'convenientSearch'
      })
      if (!chargeResult) {
        return true
      }
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
      searchContext,
      chargeResult,
      initialCacheKey,
      initialCached
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
      const chargeResult = await this.chargeSummaryUsage(e, {
        feature: 'contentSummary',
        cacheHit: true
      })
      if (!chargeResult) {
        return true
      }

      const result = cached.result
      const notices = Array.isArray(cached.notices) ? cached.notices : []
      const displayText = this.buildSummaryDisplayText(result, notices)
      const billingText = this.buildSummaryBillingText(chargeResult, e)
      const finalDisplayText = this.appendSummaryBillingText(displayText, billingText)
      const html = generateHutaoHTML('内容总结', this.buildSummaryHtmlContent(result), null, notices, { billingText })
      const userInfo = this.messageService.getUserInfo(e)
      try {
        await this.sendResult(
          e,
          [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${finalDisplayText}` }] }],
          `内容总结：\n\n${finalDisplayText}`,
          html,
          'contentSummary'
        )
        await this.completeSummaryUsage(chargeResult, 'cached_content_summary_sent')
      } catch (error) {
        await this.refundSummaryUsage(chargeResult, 'cached_summary_send_failed')
        throw error
      }
      return true
    }

    let chargeResult = null
    try {
      let orderedContextTexts = []
      const extraExtractedTexts = []
      const allImages = []
      const allVideos = []
      const allAudios = []
      const allOtherFiles = []
      const directOtherFiles = []

      this.appendExtractedFiles(directFiles, {
        images: directImages,
        videos: directVideos,
        audios: directVoices,
        others: directOtherFiles
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

      allImages.push(...directImages)
      allVideos.push(...directVideos)
      allAudios.push(...directVoices)
      allOtherFiles.push(...directOtherFiles)

      if (orderedContextTexts.length === 0 && allImages.length === 0 && allVideos.length === 0 && allAudios.length === 0 && allOtherFiles.length === 0) {
        await e.reply('未能从消息中提取到可分析内容')
        return true
      }

      chargeResult = await this.chargeSummaryUsage(e, {
        feature: 'contentSummary'
      })
      if (!chargeResult) {
        return true
      }

      await e.reply('正在分析内容，请稍候...')

      this.assignSummaryMediaLabels({
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        others: allOtherFiles
      })
      const mediaLabelAssigner = this.createSummaryMediaLabelAssigner({
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        others: allOtherFiles
      })
      orderedContextTexts = this.relabelSummaryMediaPlaceholders(orderedContextTexts, {
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        others: allOtherFiles
      }, mediaLabelAssigner)

      const directTimeline = this.buildDirectMediaTimeline(message, {
        images: directImages,
        videos: directVideos,
        audios: directVoices,
        others: directOtherFiles
      }, mediaLabelAssigner)
      if (directTimeline) {
        orderedContextTexts.push(directTimeline)
      }
      this.assignUnusedSummaryMediaLabels({
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        others: allOtherFiles
      }, mediaLabelAssigner)

      const fileLimits = this.getSummaryFileLimits()
      const imageFiles = await this.mediaService.downloadImages(allImages, 'sum_img', fileLimits.totalImageLimit)
      const videoFiles = await this.mediaService.downloadVideos(
        allVideos,
        'sum_vid',
        allVideos.length,
        {
          maxPreparedCount: fileLimits.totalVideoLimit
        }
      )
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
        const audioResults = await this.mapWithConcurrency(audioFiles, 2, async audio => {
          let mp3Path = null
          try {
            mp3Path = await this.mediaService.convertAudioToMp3(audio.localPath)
            const audioResult = mp3Path ? await this.apiService.callAudioAPI(mp3Path) : null
            return { audio, audioResult }
          } finally {
            this.mediaService.cleanupFile(mp3Path)
          }
        })

        for (const item of audioResults) {
          if (item?.error) {
            logger.warn(`[${pluginName}] 语音识别失败：${item.error.message}`)
            continue
          }

          const { audio, audioResult } = item || {}
          if (!audioResult) {
            continue
          }

          const label = audio?.summaryMediaLabel || '语音内容'
          extraExtractedTexts.push(`【${label.replace(/^\[|\]$/g, '')}】${audioResult}`)
        }
        this.mediaService.cleanupFiles(audioFiles)
      }

      const otherFileTexts = await this.summarizeOtherFiles(allOtherFiles, fileLimits.totalOtherLimit, {
        event: e,
        imageBatchLimit: fileLimits.imageMaxPerRequest
      })
      if (otherFileTexts.length > 0) {
        extraExtractedTexts.push(...otherFileTexts)
      }

      const botProfile = await this.messageService.getBotProfileForPrompt(e)
      const promptSections = []
      if (orderedContextTexts.length > 0) {
        promptSections.push('以下内容已尽量按原消息顺序整理；文中的[M1 图片]、[M2 视频]、[M3 语音]、[M4 附件]等编号会与后续媒体分析结果一一对应。若某张长图或某个视频被自动切片，其片段仍属于同一个编号，请结合前后文连续理解，不要打乱对应关系。')
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
      const summaryNotices = this.buildMediaProcessingNotices(imageFiles.summaryMeta, videoFiles.summaryMeta, {
        processedImageCount: imageFiles.length,
        totalImageLimit: fileLimits.totalImageLimit,
        processedVideoCount: videoFiles.length,
        totalVideoLimit: fileLimits.totalVideoLimit
      })

      if (!result) {
        await this.refundSummaryUsage(chargeResult, 'empty_content_summary')
        await e.reply('总结失败，请稍后重试')
        return true
      }

      this.setCache(cacheKey, { result, notices: summaryNotices })
      const displayText = this.buildSummaryDisplayText(result, summaryNotices)
      const billingText = this.buildSummaryBillingText(chargeResult, e)
      const finalDisplayText = this.appendSummaryBillingText(displayText, billingText)
      const html = generateHutaoHTML('内容总结', this.buildSummaryHtmlContent(result), null, summaryNotices, { billingText })
      const userInfo = this.messageService.getUserInfo(e)
      await this.sendResult(
        e,
        [{ ...userInfo, message: [{ type: 'text', text: `═══ 内容总结 ═══\n\n${finalDisplayText}` }] }],
        `内容总结：\n\n${finalDisplayText}`,
        html,
        'contentSummary'
      )
      await this.completeSummaryUsage(chargeResult, 'content_summary_sent')
    } catch (error) {
      await this.refundSummaryUsage(chargeResult, 'content_summary_failed')
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
      return this.sendCachedGroupSummary(e, cached, {
        skipBilling: options.skipBilling
      })
    }

    if (await this.waitForGroupSummaryCache(e, cacheKey, moduleName, {
      skipBilling: options.skipBilling
    })) {
      return true
    }

    if (this.getActiveGroupSummaryInflight(cacheKey)) {
      if (await this.waitForGroupSummaryCache(e, cacheKey, moduleName, {
        skipBilling: options.skipBilling
      })) {
        return true
      }
    }

    const inflightEntry = this.registerGroupSummaryInflight(cacheKey, {
      moduleName,
      groupId: e.group_id,
      userId: e.user_id,
      isMemberMode: actualMembers.length > 0,
      messageCount,
      timeRangeHours
    })
    const targetText = actualMembers.length > 0 ? `被 @ 的 ${actualMembers.length} 位成员` : '群聊'
    await e.reply(
      timeRangeHours > 0
        ? `正在获取${targetText}最近 ${timeRangeHours} 小时内最多 ${messageCount} 条消息进行分析...`
        : `正在获取${targetText}最近 ${messageCount} 条消息进行分析...`
    )

    let chargeResult = null
    try {
      const rawMessages = await this.messageService.getGroupHistoryMessages(e, Math.min(messageCount, chatConfig.maxMessageCount || 500))
      if (!rawMessages || rawMessages.length === 0) {
        await e.reply('无法获取群聊历史消息，请确认机器人权限')
        this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
          ok: false,
          reason: 'empty_history'
        })
        return true
      }

      const messages = this.messageService.filterMessagesByTimeRange(rawMessages, timeRangeHours)
      if (messages.length === 0 && timeRangeHours > 0) {
        await e.reply(`最近 ${timeRangeHours} 小时内没有可分析的群消息`)
        this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
          ok: false,
          reason: 'empty_time_range'
        })
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
        this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
          ok: false,
          reason: 'empty_formatted_messages'
        })
        return true
      }

      chargeResult = await this.chargeSummaryUsage(e, {
        feature: actualMembers.length > 0 ? 'memberSummary' : 'groupChatSummary',
        skipBilling: options.skipBilling
      })
      if (!chargeResult) {
        this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
          ok: false,
          reason: 'billing_rejected'
        })
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
      const docTextBlocks = await this.summarizeOtherFiles(allDocFiles, fileLimits.totalOtherLimit, {
        previewLimit: chatConfig.docMaxChars || 2000,
        includeLimitNote: false,
        event: e,
        imageBatchLimit: fileLimits.imageMaxPerRequest
      })
      if (docTextBlocks.length > 0) {
        docTexts = `\n\n${docTextBlocks.join('\n\n')}`
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

      const title = actualMembers.length > 0 ? '成员发言总结' : '群聊总结'
      const isMemberMode = actualMembers.length > 0
      const statsData = {
        messageCount: formattedMessages.length,
        memberCount: Object.keys(userMessageCounts).length,
        sortedMembers,
        hourlyActivity,
        statsText
      }
      let result = ''
      let degraded = false

      try {
        result = await this.apiService.callSummaryTextAPI(prompt)
      } catch (error) {
        degraded = true
        logger.warn(`[${pluginName}] ${title}模型总结失败，已降级为规则摘要：${this.apiService.formatErrorWithCause?.(error) || error.message}`)
        result = this.buildRuleBasedGroupSummary({
          formattedMessages,
          sortedMembers,
          statsText,
          imageSummary,
          docTexts,
          error,
          isMemberMode
        })
      }

      if (!result) {
        degraded = true
        result = this.buildRuleBasedGroupSummary({
          formattedMessages,
          sortedMembers,
          statsText,
          imageSummary,
          docTexts,
          isMemberMode
        })
      }

      if (!degraded) {
        this.setCache(cacheKey, {
          result,
          statsData,
          title,
          isMemberMode
        })
      } else {
        await this.refundSummaryUsage(chargeResult, 'group_summary_degraded')
      }

      const parsed = parseSummaryContent(result)
      const userInfo = this.messageService.getUserInfo(e)
      const billingText = this.buildSummaryBillingText(chargeResult, e)
      const fallbackText = this.appendSummaryBillingText(`${title}：\n\n${result}`, billingText)
      const forwardText = this.appendSummaryBillingText(
        `═══ ${title} ═══\n\n📊 消息数量：${statsData.messageCount}条\n👥 活跃成员：${statsData.memberCount}人\n📈 发言排行：${statsText}\n\n═══ 内容分析 ═══\n\n${result}`,
        billingText
      )
      await this.sendResult(
        e,
        [{
          ...userInfo,
          message: [{
            type: 'text',
            text: forwardText
          }]
        }],
        fallbackText,
        generateGroupSummaryHTML(title, parsed, { ...statsData, isMemberMode, billingText }),
        isMemberMode ? 'memberSummary' : 'groupChatSummary'
      )
      if (!degraded) {
        await this.completeSummaryUsage(chargeResult, 'group_summary_sent')
      }
      this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
        ok: !degraded,
        cached: !degraded
      })
    } catch (error) {
      await this.refundSummaryUsage(chargeResult, 'group_summary_failed')
      logger.error(`[${pluginName}] 群聊总结失败`, error)
      await e.reply('总结失败，请稍后重试')
      this.finishGroupSummaryInflight(cacheKey, inflightEntry, {
        ok: false,
        error
      })
    }

    return true
  }

  async doSearch(e, searchQuery, options = {}) {
    const displayKeyword = options.displayKeyword || searchQuery
    const rawQuestion = options.rawQuestion || displayKeyword
    const searchContext = options.searchContext?.hasContext ? options.searchContext : null
    const userInfo = this.messageService.getUserInfo(e)
    const cacheKey = this.getCacheKey('search', searchQuery)
    const cached = options.initialCacheKey === cacheKey
      ? (options.initialCached || this.tryGetCache(cacheKey, '搜索'))
      : this.tryGetCache(cacheKey, '搜索')
    let chargeResult = options.chargeResult || null
    const cacheReady = Boolean(!searchContext && cached?.rawContent && cached?.data)
    if (!chargeResult && cacheReady) {
      chargeResult = await this.chargeSearchUsage(e, {
        feature: 'search',
        cacheHit: true
      })
      if (!chargeResult) {
        return true
      }
    } else if (!chargeResult) {
      chargeResult = await this.chargeSearchUsage(e, {
        feature: 'search'
      })
      if (!chargeResult) {
        return true
      }
    }
    let data = searchContext ? null : cached?.data || null
    let citations = cached?.citations || []
    let rawContent = cached?.rawContent || ''
    const screenshotPaths = []

    if (!rawContent) {
      try {
        const searchResult = await this.apiService.searchKeyword(searchQuery)
        if (!searchResult.content) {
          await e.reply(`未找到“${displayKeyword}”的相关信息`)
          await this.refundSearchUsage(chargeResult, 'empty_search_result')
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
        await this.refundSearchUsage(chargeResult, 'search_request_failed')
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
        await this.refundSearchUsage(chargeResult, 'search_organize_failed')
        return true
      }
    }

    try {
      const forwardMsg = []
      const contentText = this.buildSearchContent(data, rawContent)
      const sourceDisplay = this.getSearchSourceDisplay(citations)
      const visibleCitations = sourceDisplay.citations

      if (contentText) {
        const billingText = this.buildSearchBillingText(chargeResult, e)
        const displayContentText = this.appendBillingText(contentText, billingText)
        forwardMsg.push({
          ...userInfo,
          message: [{ type: 'text', text: `═══ ${displayKeyword} ═══\n\n${displayContentText}` }]
        })
      }

      const sourceText = this.buildSearchSourceText(displayKeyword, visibleCitations, sourceDisplay.hiddenCount)
      if (sourceText) {
        forwardMsg.push({
          ...userInfo,
          message: [{
            type: 'text',
            text: sourceText
          }]
        })

        const screenshotCount = Config.get('send.searchScreenshotCount', -1)
        const shouldCaptureScreenshots = this.getSendMode('search') === 'forward' && screenshotCount !== 0
        if (shouldCaptureScreenshots) {
          const mode = Config.get('send.searchScreenshotMode', 'viewport')
          const timeoutMs = Config.get('send.searchScreenshotTimeoutMs', 10000)
          const limit = screenshotCount === -1 ? visibleCitations.length : Math.min(visibleCitations.length, screenshotCount)
          const targets = visibleCitations.slice(0, limit)

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

      const billingText = this.buildSearchBillingText(chargeResult, e)
      const finalContentText = this.appendBillingText(contentText, billingText)
      const html = generateSearchHTML(displayKeyword, contentText, visibleCitations, {
        billingText,
        hiddenSourceCount: sourceDisplay.hiddenCount
      })
      await this.sendResult(
        e,
        forwardMsg,
        finalContentText || '查询完成',
        html,
        'search'
      )
      await this.completeSearchUsage(chargeResult, 'search_sent')
    } catch (error) {
      logger.error(`[${pluginName}] 搜索结果发送失败`, error)
      await e.reply('结果处理失败，请稍后重试')
      await this.refundSearchUsage(chargeResult, 'search_send_failed')
    } finally {
      this.mediaService.cleanupFiles(screenshotPaths)
    }

    return true
  }
}

export default new BaikeService()

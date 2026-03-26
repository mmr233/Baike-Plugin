import fs from 'node:fs'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { debugLog } from '../debug.js'
import { beautifyText, extractKeyword } from '../../utils/text.js'
import { sleep } from '../../utils/common.js'

function parseJson(text, context = '接口响应') {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${context} 不是合法 JSON：${text.slice(0, 200)}`)
  }
}

function extractFirstJsonBlock(text = '') {
  const source = String(text || '')
  const startCandidates = [source.indexOf('{'), source.indexOf('[')].filter(index => index >= 0)
  if (startCandidates.length === 0) {
    return ''
  }

  const startIndex = Math.min(...startCandidates)
  const opening = source[startIndex]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && inString) {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === opening) {
      depth += 1
    } else if (char === closing) {
      depth -= 1
      if (depth === 0) {
        return source.slice(startIndex, index + 1)
      }
    }
  }

  return ''
}

function parseJsonContent(text, fallback = null) {
  const content = String(text || '').trim()
  if (!content) {
    return fallback
  }

  const candidates = [content]
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim())
  }

  const firstJsonBlock = extractFirstJsonBlock(content)
  if (firstJsonBlock) {
    candidates.push(firstJsonBlock.trim())
  }

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return JSON.parse(candidate)
    } catch {}
  }

  return fallback
}

function truncateDebugText(value, limit = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function pushTextParts(value, parts, depth = 0) {
  if (depth > 8 || value === undefined || value === null) {
    return
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized) {
      parts.push(normalized)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      pushTextParts(item, parts, depth + 1)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  for (const field of ['text', 'output_text']) {
    if (typeof value[field] === 'string' && value[field].trim()) {
      parts.push(value[field].trim())
    }
  }

  if (value.message) {
    pushTextParts(value.message.content ?? value.message, parts, depth + 1)
  }

  for (const field of ['content', 'output', 'parts', 'items']) {
    const nested = value[field]
    if (nested !== undefined && typeof nested !== 'string') {
      pushTextParts(nested, parts, depth + 1)
    } else if (typeof nested === 'string' && nested.trim()) {
      parts.push(nested.trim())
    }
  }
}

function dedupeStrings(items = []) {
  return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))]
}

function extractResponseText(json = {}) {
  const parts = []
  const candidates = [
    json?.choices?.[0]?.message?.content,
    json?.choices?.[0]?.message,
    json?.choices?.[0]?.delta?.content,
    json?.output_text,
    json?.output,
    json?.content
  ]

  for (const candidate of candidates) {
    pushTextParts(candidate, parts)
  }

  return dedupeStrings(parts).join('\n').trim()
}

function pushCitationUrls(value, urls, depth = 0) {
  if (depth > 8 || value === undefined || value === null) {
    return
  }

  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s)>\]]+/gi) || []
    for (const match of matches) {
      urls.push(match.replace(/[.,;]+$/, ''))
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      pushCitationUrls(item, urls, depth + 1)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  for (const field of ['url', 'uri', 'source_url', 'sourceUrl', 'webpage_url', 'webpageUrl', 'link', 'href']) {
    if (typeof value[field] === 'string') {
      pushCitationUrls(value[field], urls, depth + 1)
    }
  }

  for (const field of ['citations', 'annotations', 'source', 'content', 'message', 'output', 'items']) {
    if (value[field] !== undefined) {
      pushCitationUrls(value[field], urls, depth + 1)
    }
  }
}

function extractResponseCitations(json = {}, text = '') {
  const urls = []
  const candidates = [
    json?.citations,
    json?.choices?.[0]?.message?.citations,
    json?.choices?.[0]?.message?.annotations,
    json?.choices?.[0]?.citations,
    json?.output,
    text
  ]

  for (const candidate of candidates) {
    pushCitationUrls(candidate, urls)
  }

  return dedupeStrings(urls)
}

function normalizeSearchResultObject(parsed, rawText = '') {
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  if (Array.isArray(parsed)) {
    return {
      内容: parsed.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n')
    }
  }

  const detailInfo = parsed.详细信息
    ?? parsed.detail
    ?? parsed.details
    ?? parsed.详细内容
    ?? parsed.info
  const summary = parsed.总结
    ?? parsed.summary
    ?? parsed.answer
    ?? parsed.overview
  const content = parsed.内容
    ?? parsed.content
    ?? parsed.text

  if (detailInfo !== undefined || summary !== undefined || content !== undefined) {
    const normalized = {}
    if (detailInfo !== undefined) {
      normalized.详细信息 = detailInfo
    }
    if (summary !== undefined) {
      normalized.总结 = summary
    }
    if (content !== undefined) {
      normalized.内容 = content
    }
    return normalized
  }

  if (Object.keys(parsed).length > 0) {
    return {
      详细信息: parsed,
      内容: rawText || JSON.stringify(parsed)
    }
  }

  return null
}

function parseSearchSections(text = '') {
  const content = String(text || '').trim()
  if (!content) {
    return null
  }

  const detailMatch = content.match(/(?:^|\n)(?:#+\s*)?(?:详细信息|详情|基本信息|介绍)\s*[:：]?\s*([\s\S]*?)(?=(?:\n(?:#+\s*)?(?:总结|概述|结论)\s*[:：]?)|$)/i)
  const summaryMatch = content.match(/(?:^|\n)(?:#+\s*)?(?:总结|概述|结论)\s*[:：]?\s*([\s\S]*)$/i)
  const detailInfo = detailMatch?.[1]?.trim() || ''
  const summary = summaryMatch?.[1]?.trim() || ''

  if (!detailInfo && !summary) {
    return null
  }

  return {
    ...(detailInfo ? { 详细信息: detailInfo } : {}),
    ...(summary ? { 总结: summary } : {})
  }
}

function getImageMimeType(filePath = '') {
  const normalized = String(filePath || '').toLowerCase()
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }
  if (normalized.endsWith('.bmp')) {
    return 'image/bmp'
  }
  return 'image/jpeg'
}

function truncatePromptText(text = '', maxLength = 320) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!normalized) {
    return ''
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized
}

function buildSearchSummaryContextPrompt(context = {}, question = '') {
  const replyText = truncatePromptText(context?.replyText || '', 360)
  const replyNearbyTexts = (Array.isArray(context?.replyNearbyTexts) ? context.replyNearbyTexts : [])
    .map(item => truncatePromptText(item, 220))
    .filter(Boolean)
    .slice(0, 12)
  const historyTexts = (Array.isArray(context?.historyTexts) ? context.historyTexts : [])
    .map(item => truncatePromptText(item, 220))
    .filter(Boolean)
    .slice(0, 8)
  const currentQuestion = truncatePromptText(question || '', 160)
  const hasContext = Boolean(replyText || replyNearbyTexts.length > 0 || historyTexts.length > 0)

  if (!hasContext) {
    return {
      hasContext: false,
      promptText: ''
    }
  }

  return {
    hasContext: true,
    promptText: [
      '补充说明：下面的“当前问题 / 引用消息 / 前序消息”只能用于理解用户真正想问的对象、角度和重点，不能把其中内容当成事实来源。',
      '如果上下文与搜索结果冲突，必须以搜索结果为准。',
      currentQuestion ? `当前问题：${currentQuestion}` : '',
      `引用消息：${replyText || '无'}`,
      '引用附近消息：',
      replyNearbyTexts.length > 0
        ? replyNearbyTexts.map((item, index) => `${index + 1}. ${item}`).join('\n')
        : '无',
      '前序消息：',
      historyTexts.length > 0
        ? historyTexts.map((item, index) => `${index + 1}. ${item}`).join('\n')
        : '无'
    ].filter(Boolean).join('\n\n')
  }
}

class ApiService {
  isPenaltyUnsupportedModel(model = '') {
    return /grok-(3|4)/i.test(String(model || ''))
  }

  normalizeTimeoutMs(value, fallback = 120000) {
    const timeoutMs = Number(value)
    if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
      return timeoutMs
    }
    return fallback
  }

  normalizeRetryCount(value, fallback = 0) {
    const retryCount = Number(value)
    if (Number.isFinite(retryCount) && retryCount >= 0) {
      return Math.min(5, Math.floor(retryCount))
    }
    return fallback
  }

  getModelConfig(modelType) {
    const apiConfig = Config.get('api', {})
    const modelConfig = apiConfig?.[modelType] || {}

    return {
      baseUrl: (modelConfig.baseUrl || apiConfig.primaryBaseUrl || '').replace(/\/$/, ''),
      apiKey: modelConfig.apiKey || apiConfig.primaryApiKey || '',
      model: modelConfig.model || '',
      timeoutMs: this.normalizeTimeoutMs(modelConfig.timeoutMs, 120000),
      retryCount: this.normalizeRetryCount(modelConfig.retryCount, 0)
    }
  }

  isRetryableStatus(status) {
    return [408, 409, 425, 429].includes(status) || status >= 500
  }

  isRetryableError(error) {
    if (!error) {
      return false
    }

    if (error.name === 'AbortError' || error.retryable === true) {
      return true
    }

    if (this.isRetryableStatus(Number(error.status))) {
      return true
    }

    return /timeout|timed out|econnreset|econnrefused|enotfound|eai_again|socket hang up/i.test(String(error.message || ''))
  }

  getRetryDelayMs(attempt) {
    return Math.min(5000, 1200 * (attempt + 1))
  }

  async requestChatCompletion(modelType, messages, options = {}) {
    const {
      baseUrl,
      apiKey,
      model,
      timeoutMs,
      retryCount
    } = this.getModelConfig(modelType)

    if (!baseUrl || !apiKey || !model) {
      throw new Error(`${modelType} 模型配置不完整，请检查锅巴面板或配置文件`)
    }

    const requestTimeout = this.normalizeTimeoutMs(options.timeoutMs ?? options.timeout, timeoutMs)
    const maxRetries = this.normalizeRetryCount(options.retryCount, retryCount)

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout)

      try {
        debugLog('api.request', `准备请求 ${modelType}`, {
          baseUrl,
          model,
          timeout: requestTimeout,
          retryCount: maxRetries,
          attempt: attempt + 1,
          messageCount: Array.isArray(messages) ? messages.length : 0
        })

        const payload = {
          model,
          group: 'default',
          messages,
          stream: false,
          temperature: options.temperature ?? 0.3,
          top_p: options.topP ?? 1
        }

        if (!this.isPenaltyUnsupportedModel(model)) {
          payload.frequency_penalty = options.frequencyPenalty ?? 0
          payload.presence_penalty = options.presencePenalty ?? 0
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        })

        const text = await response.text()
        debugLog('api.response', `${modelType} 响应`, {
          ok: response.ok,
          status: response.status,
          attempt: attempt + 1,
          preview: text.slice(0, 200)
        })
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
          error.status = response.status
          error.retryable = this.isRetryableStatus(response.status)
          throw error
        }

        return {
          text,
          json: parseJson(text, `${modelType} 响应`)
        }
      } catch (error) {
        const shouldRetry = attempt < maxRetries && this.isRetryableError(error)
        if (!shouldRetry) {
          throw error
        }

        const delayMs = this.getRetryDelayMs(attempt)
        logger.warn(
          `[${pluginName}] ${modelType} 请求失败，${delayMs}ms 后进行第 ${attempt + 2} 次尝试：${error.message}`
        )
        await sleep(delayMs)
      } finally {
        clearTimeout(timeoutId)
      }
    }

    throw new Error(`${modelType} 请求失败：超过最大重试次数`)
  }

  async callAudioAPI(audioPath) {
    if (!audioPath || !fs.existsSync(audioPath)) {
      return null
    }

    const base64 = fs.readFileSync(audioPath).toString('base64')
    const { json } = await this.requestChatCompletion('audio', [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请将这段语音转录为文字，直接输出内容，不要包含任何其他描述。' },
          { type: 'input_audio', input_audio: { data: base64, format: 'mp3' } }
        ]
      }
    ])

    return extractResponseText(json) || null
  }

  async callTextImageAPI(content, imageFiles = [], systemPromptOverride = null) {
    const promptConfig = Config.get('prompt', {})
    const userContent = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    let imageCount = 0
    for (const media of imageFiles) {
      if (media.type !== 'image' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      const base64 = fs.readFileSync(media.localPath).toString('base64')
      const mimeType = getImageMimeType(media.localPath)
      if (mimeType === 'image/gif') {
        logger.warn(`[${pluginName}] 检测到未静态化的 GIF，已跳过：${media.localPath}`)
        continue
      }
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      })
      imageCount += 1
    }

    if (userContent.length === 0) {
      return null
    }

    let systemPrompt = systemPromptOverride || promptConfig.summaryDefault || ''
    if (!systemPromptOverride && imageCount > 0) {
      systemPrompt += (promptConfig.summaryImageAppend || '').replace('{count}', imageCount)
    }

    const { json } = await this.requestChatCompletion('summary', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ])

    const result = extractResponseText(json) || null
    return result ? beautifyText(result) : null
  }

  async callVideoAPI(content, videoFiles = [], systemPromptOverride = null) {
    const promptConfig = Config.get('prompt', {})
    const userContent = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    let videoCount = 0
    for (const media of videoFiles) {
      if (media.type !== 'video' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      const base64 = fs.readFileSync(media.localPath).toString('base64')
      userContent.push({
        type: 'video_url',
        video_url: {
          url: `data:video/mp4;base64,${base64}`
        }
      })
      videoCount += 1
    }

    if (videoCount === 0) {
      return null
    }

    const { json } = await this.requestChatCompletion('video', [
      { role: 'system', content: systemPromptOverride || promptConfig.video || '' },
      { role: 'user', content: userContent }
    ])

    const result = extractResponseText(json) || null
    return result ? beautifyText(result) : null
  }

  async callSummaryAPI(content, mediaFiles = []) {
    const fileConfig = Config.get('fileRequest', {})
    const imageFiles = mediaFiles.filter(item => item.type === 'image')
    const videoFiles = mediaFiles.filter(item => item.type === 'video')
    const results = []

    if (content || imageFiles.length > 0) {
      const imageLimit = fileConfig.imageMaxPerRequest || 20
      const loopLimit = fileConfig.maxRequestLoops || 1
      const totalBatches = Math.ceil(imageFiles.length / imageLimit) || 1
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = imageFiles.slice(batch * imageLimit, (batch + 1) * imageLimit)
        const prompt = batch === 0 ? content : `继续分析第${batch + 1}批图片内容`
        const result = await this.callTextImageAPI(prompt, chunk)
        if (result) {
          results.push(actualBatches > 1 ? `【第${batch + 1}批图片分析】\n${result}` : result)
        }
      }
    }

    if (videoFiles.length > 0) {
      const videoLimit = fileConfig.videoMaxPerRequest || 3
      const loopLimit = fileConfig.maxRequestLoops || 1
      const totalBatches = Math.ceil(videoFiles.length / videoLimit)
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = videoFiles.slice(batch * videoLimit, (batch + 1) * videoLimit)
        const prompt = batch === 0
          ? (content ? `请结合以下背景信息分析视频：${content}` : '请分析这个视频的内容')
          : `继续分析第${batch + 1}批视频内容`

        const result = await this.callVideoAPI(prompt, chunk)
        if (result) {
          results.push(actualBatches > 1 ? `【第${batch + 1}批视频分析】\n${result}` : result)
        }
      }
    }

    return results.length > 0 ? results.join('\n\n') : null
  }

  async searchKeyword(keyword) {
    const { json } = await this.requestChatCompletion('search', [
      { role: 'user', content: keyword }
    ], {
      temperature: 0.7
    })
    const content = extractResponseText(json)

    return {
      content,
      citations: extractResponseCitations(json, content)
    }
  }

  async resolveSearchQuery(question, context = {}) {
    const currentQuestion = String(question || '').trim()
    if (!currentQuestion) {
      return {
        query: '',
        displayKeyword: '',
        usedContext: false
      }
    }

    const replyText = String(context.replyText || '').trim()
    const replyNearbyTexts = Array.isArray(context.replyNearbyTexts) ? context.replyNearbyTexts.filter(Boolean) : []
    const historyTexts = Array.isArray(context.historyTexts) ? context.historyTexts.filter(Boolean) : []

    debugLog('search.intent', '准备解析搜索意图', {
      question: truncateDebugText(currentQuestion, 120),
      replyInjected: Boolean(replyText),
      replyNearbyCount: replyNearbyTexts.length,
      historyCount: historyTexts.length,
      replyPreview: truncateDebugText(replyText, 160),
      replyNearbyPreview: replyNearbyTexts.slice(0, 2).map(item => truncateDebugText(item, 120)),
      historyPreview: historyTexts.slice(0, 2).map(item => truncateDebugText(item, 120))
    })

    if (!replyText && replyNearbyTexts.length === 0 && historyTexts.length === 0) {
      const displayKeyword = extractKeyword(currentQuestion) || currentQuestion
      return {
        query: currentQuestion,
        displayKeyword,
        usedContext: false
      }
    }

    const systemPrompt = [
      '你是一个搜索意图解析助手。',
      '请结合用户当前问题、引用消息和前序消息，消解指代、省略和上下文依赖，把它改写成适合直接搜索的明确查询。',
      '输出 JSON，且只能包含三个字段：query、displayKeyword、useContext。',
      'query：最终用于搜索的一句话或短语，必须明确，不要保留“他/她/它/这个/那个/上面这个”等模糊指代。',
      'displayKeyword：核心查询对象或主题，尽量简短，例如“胡桃”“往生堂”“米哈游”。',
      'useContext：布尔值，表示是否实际使用了上下文。',
      '如果上下文不足以确定具体对象，不要编造，尽量保留原问题原意。只输出 JSON，不要输出其他说明。'
    ].join('\n')

    const userPrompt = [
      `当前问题：${currentQuestion}`,
      '',
      `引用消息：${replyText || '无'}`,
      '',
      '引用附近消息：',
      replyNearbyTexts.length > 0 ? replyNearbyTexts.map((item, index) => `${index + 1}. ${item}`).join('\n') : '无',
      '',
      '前序消息：',
      historyTexts.length > 0 ? historyTexts.map((item, index) => `${index + 1}. ${item}`).join('\n') : '无'
    ].join('\n')

    const { json } = await this.requestChatCompletion('search', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      temperature: 0.1
    })

    const content = extractResponseText(json)
    const parsed = parseJsonContent(content, {})
    const query = String(parsed?.query || '').trim() || currentQuestion
    const displayKeyword = String(parsed?.displayKeyword || '').trim() || extractKeyword(query) || query
    const usedContext = Boolean(parsed?.useContext)

    debugLog('search.intent', '搜索意图解析完成', {
      query: truncateDebugText(query, 160),
      displayKeyword: truncateDebugText(displayKeyword, 80),
      usedContext,
      modelOutputPreview: truncateDebugText(content, 200)
    })

    return {
      query,
      displayKeyword,
      usedContext
    }
  }

  async organizeSearchResult(keyword, searchContent, options = {}) {
    const prompt = Config.get('prompt.search', '')
    const summaryContext = buildSearchSummaryContextPrompt(options.context, options.question || keyword)
    const userPrompt = summaryContext.hasContext
      ? [
          `请整理以下关于"${keyword}"的搜索结果：`,
          '',
          summaryContext.promptText,
          '',
          '请优先整理最能回答用户当前语境的问题的信息，但最终内容必须完全基于下面的搜索结果。',
          '',
          '搜索结果：',
          searchContent
        ].join('\n')
      : `请整理以下关于"${keyword}"的搜索结果：\n\n${searchContent}`

    const { json } = await this.requestChatCompletion('summary', [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: userPrompt
      }
    ])

    const summaryContent = extractResponseText(json)
    const parsed = normalizeSearchResultObject(parseJsonContent(summaryContent, null), summaryContent)

    if (parsed) {
      return parsed
    }

    const sectionParsed = parseSearchSections(summaryContent)
    if (sectionParsed) {
      return sectionParsed
    }

    logger.warn(`[${pluginName}] 搜索结果结构化失败，已降级为纯文本`)
    return { 内容: summaryContent || searchContent }
  }
}

export default ApiService

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import Config from '../Config.js'
import resultCache from '../cache.js'
import { pluginName } from '../constant.js'
import { debugLog } from '../debug.js'
import { beautifyText, extractKeyword } from '../../utils/text.js'
import { sleep } from '../../utils/common.js'

const execFile = promisify(execFileCallback)
const DEFAULT_CONNECT_TIMEOUT_MS = 30000
const fetchDispatcherCache = new Map()
let undiciAgentPromise = null
let undiciUnavailableWarned = false

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function clampFloat(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, numeric))
}

function parseJson(text, context = '接口响应') {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${context} 不是合法 JSON：${text.slice(0, 200)}`)
  }
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex')
}

function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex')
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

  if (value.content?.parts) {
    pushTextParts(value.content.parts, parts, depth + 1)
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

function pushSequentialTextParts(value, parts, depth = 0) {
  if (depth > 8 || value === undefined || value === null) {
    return
  }

  if (typeof value === 'string') {
    parts.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      pushSequentialTextParts(item, parts, depth + 1)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  for (const field of ['text', 'output_text']) {
    if (typeof value[field] === 'string') {
      parts.push(value[field])
    }
  }

  if (value.message) {
    pushSequentialTextParts(value.message.content ?? value.message, parts, depth + 1)
  }

  if (value.content?.parts) {
    pushSequentialTextParts(value.content.parts, parts, depth + 1)
  }

  for (const field of ['content', 'output', 'parts', 'items']) {
    const nested = value[field]
    if (nested !== undefined && typeof nested !== 'string') {
      pushSequentialTextParts(nested, parts, depth + 1)
    } else if (typeof nested === 'string') {
      parts.push(nested)
    }
  }
}

function extractResponseText(json = {}) {
  const parts = []
  const candidates = [
    json?.choices?.[0]?.message?.content,
    json?.choices?.[0]?.message,
    json?.choices?.[0]?.delta?.content,
    json?.output_text,
    json?.output,
    json?.content,
    json?.delta?.text,
    json?.candidates
  ]

  for (const candidate of candidates) {
    pushTextParts(candidate, parts)
  }

  return dedupeStrings(parts).join('\n').trim()
}

function normalizeUsageObject(usage = null) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const promptTokens = Number(
    usage.prompt_tokens
      ?? usage.promptTokens
      ?? usage.input_tokens
      ?? usage.inputTokens
      ?? usage.promptTokenCount
      ?? usage.cachedContentTokenCount
      ?? 0
  ) || 0
  const completionTokens = Number(
    usage.completion_tokens
      ?? usage.completionTokens
      ?? usage.output_tokens
      ?? usage.outputTokens
      ?? usage.candidatesTokenCount
      ?? 0
  ) || 0
  const totalTokens = Number(
    usage.total_tokens
      ?? usage.totalTokens
      ?? usage.totalTokenCount
      ?? (promptTokens + completionTokens)
      ?? 0
  ) || 0

  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
    return null
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens
  }
}

function extractResponseUsage(json = {}) {
  const candidates = [
    json?.usage,
    json?.response?.usage,
    json?.choices?.[0]?.usage,
    json?.message?.usage,
    json?.usageMetadata
  ]

  if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      candidates.push(item?.usage)
      candidates.push(item?.response?.usage)
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeUsageObject(candidate)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function normalizeEndpointType(value = '', fallback = 'openai-chat') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-native', 'inherit'].includes(normalized)
    ? normalized
    : fallback
}

function appendEndpointPath(baseUrl = '', endpointType = 'openai-chat', model = '', requestMode = 'response') {
  const base = String(baseUrl || '').replace(/\/$/, '')
  if (!base) {
    return ''
  }

  if (endpointType === 'openai-responses') {
    return /\/responses$/i.test(base) ? base : `${base}/responses`
  }

  if (endpointType === 'anthropic-messages') {
    return /\/messages$/i.test(base) ? base : `${base}/messages`
  }

  if (endpointType === 'gemini-native') {
    if (/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/i.test(base)) {
      return requestMode === 'stream' ? appendQueryParam(base, 'alt', 'sse') : base
    }
    const action = requestMode === 'stream' ? 'streamGenerateContent' : 'generateContent'
    const resource = buildGeminiModelResource(model)
    const url = `${base}/${resource}:${action}`
    return requestMode === 'stream' ? appendQueryParam(url, 'alt', 'sse') : url
  }

  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function appendQueryParam(url = '', key = '', value = '') {
  const source = String(url || '')
  const separator = source.includes('?') ? '&' : '?'
  if (new RegExp(`(?:[?&])${key}=`).test(source)) {
    return source
  }
  return `${source}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function buildGeminiModelResource(model = '') {
  const value = String(model || '').trim().replace(/^\/+/, '')
  if (!value) {
    return 'models/'
  }

  if (/^(models|tunedModels)\//i.test(value)) {
    return value.split('/').map(part => encodeURIComponent(part)).join('/')
  }

  return `models/${encodeURIComponent(value)}`
}

function isDataUrl(value = '') {
  return /^data:[^;]+;base64,/i.test(String(value || ''))
}

function parseDataUrl(value = '') {
  const match = String(value || '').match(/^data:([^;]+);base64,(.*)$/i)
  if (!match) {
    return {
      mediaType: '',
      data: ''
    }
  }

  return {
    mediaType: match[1],
    data: match[2]
  }
}

function normalizeMessageContentToText(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return String(content || '')
  }

  return content
    .map(part => {
      if (typeof part === 'string') {
        return part
      }
      if (part?.type === 'text') {
        return part.text || ''
      }
      if (part?.type === 'image_url') {
        return '[图片]'
      }
      if (part?.type === 'video_url') {
        return '[视频]'
      }
      if (part?.type === 'input_audio') {
        return '[音频]'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toOpenAIResponsesContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return String(content || '')
  }

  return content.map(part => {
    if (typeof part === 'string') {
      return { type: 'input_text', text: part }
    }
    if (part?.type === 'text') {
      return { type: 'input_text', text: String(part.text || '') }
    }
    if (part?.type === 'image_url') {
      return {
        type: 'input_image',
        image_url: part.image_url?.url || part.url || ''
      }
    }
    if (part?.type === 'input_audio') {
      return {
        type: 'input_audio',
        input_audio: part.input_audio || {}
      }
    }
    if (part?.type === 'video_url') {
      return { type: 'input_text', text: '[视频]' }
    }
    return { type: 'input_text', text: normalizeMessageContentToText([part]) }
  }).filter(part => part.text || part.image_url || part.input_audio)
}

function toAnthropicContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return String(content || '')
  }

  return content.map(part => {
    if (typeof part === 'string') {
      return { type: 'text', text: part }
    }
    if (part?.type === 'text') {
      return { type: 'text', text: String(part.text || '') }
    }
    if (part?.type === 'image_url') {
      const url = part.image_url?.url || part.url || ''
      if (isDataUrl(url)) {
        const parsed = parseDataUrl(url)
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mediaType || 'image/jpeg',
            data: parsed.data
          }
        }
      }
      return { type: 'text', text: `[图片: ${url || '未提供'}]` }
    }
    if (part?.type === 'video_url') {
      return { type: 'text', text: '[视频]' }
    }
    if (part?.type === 'input_audio') {
      return { type: 'text', text: '[音频]' }
    }
    return { type: 'text', text: normalizeMessageContentToText([part]) }
  }).filter(part => part.text || part.source)
}

function toGeminiParts(content) {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : []
  }

  if (!Array.isArray(content)) {
    const text = String(content || '')
    return text ? [{ text }] : []
  }

  return content.map(part => {
    if (typeof part === 'string') {
      return part ? { text: part } : null
    }
    if (part?.type === 'text') {
      const text = String(part.text || '')
      return text ? { text } : null
    }
    if (part?.type === 'image_url') {
      const url = part.image_url?.url || part.url || ''
      if (isDataUrl(url)) {
        const parsed = parseDataUrl(url)
        return {
          inlineData: {
            mimeType: parsed.mediaType || 'image/jpeg',
            data: parsed.data
          }
        }
      }
      return { fileData: { fileUri: url, mimeType: 'image/jpeg' } }
    }
    if (part?.type === 'video_url') {
      const url = part.video_url?.url || part.url || ''
      if (isDataUrl(url)) {
        const parsed = parseDataUrl(url)
        return {
          inlineData: {
            mimeType: parsed.mediaType || 'video/mp4',
            data: parsed.data
          }
        }
      }
      return { fileData: { fileUri: url, mimeType: 'video/mp4' } }
    }
    if (part?.type === 'input_audio') {
      const audio = part.input_audio || {}
      const format = String(audio.format || 'mp3').replace(/^audio\//, '')
      return {
        inlineData: {
          mimeType: `audio/${format === 'mp3' ? 'mpeg' : format}`,
          data: String(audio.data || '')
        }
      }
    }
    const text = normalizeMessageContentToText([part])
    return text ? { text } : null
  }).filter(Boolean)
}

function splitSystemAndMessages(messages = []) {
  const systemParts = []
  const conversation = []

  for (const message of messages || []) {
    const role = String(message?.role || 'user').trim() || 'user'
    if (role === 'system') {
      const text = normalizeMessageContentToText(message.content).trim()
      if (text) {
        systemParts.push(text)
      }
      continue
    }
    conversation.push({
      ...message,
      role: role === 'assistant' ? 'assistant' : 'user'
    })
  }

  return {
    system: systemParts.join('\n\n'),
    messages: conversation
  }
}

function buildEndpointRequest(candidate = {}, messages = [], options = {}, requestMode = 'response') {
  const endpointType = candidate.endpointType || 'openai-chat'
  const stream = requestMode === 'stream'
  const temperature = options.temperature ?? 0.3
  const topP = options.topP ?? 1

  if (endpointType === 'openai-responses') {
    const split = splitSystemAndMessages(messages)
    const input = split.messages.map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: toOpenAIResponsesContent(message.content)
    }))

    return {
      payload: {
        model: candidate.model,
        input,
        ...(split.system ? { instructions: split.system } : {}),
        stream,
        temperature,
        top_p: topP
      },
      headers: {}
    }
  }

  if (endpointType === 'anthropic-messages') {
    const split = splitSystemAndMessages(messages)
    return {
      payload: {
        model: candidate.model,
        max_tokens: Math.max(1, Number(options.maxTokens || options.max_tokens || 4096) || 4096),
        messages: split.messages.map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: toAnthropicContent(message.content)
        })),
        ...(split.system ? { system: split.system } : {}),
        ...(stream ? { stream: true } : {}),
        temperature,
        top_p: topP
      },
      headers: {
        'anthropic-version': options.anthropicVersion || candidate.anthropicVersion || '2023-06-01'
      }
    }
  }

  if (endpointType === 'gemini-native') {
    const split = splitSystemAndMessages(messages)
    return {
      payload: {
        contents: split.messages.map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: toGeminiParts(message.content)
        })).filter(item => item.parts.length > 0),
        ...(split.system ? { systemInstruction: { parts: [{ text: split.system }] } } : {}),
        generationConfig: {
          temperature,
          topP
        }
      },
      headers: {}
    }
  }

  const payload = {
    model: candidate.model,
    group: 'default',
    messages,
    stream,
    temperature,
    top_p: topP
  }

  if (!/grok-(3|4)/i.test(String(candidate.model || ''))) {
    payload.frequency_penalty = options.frequencyPenalty ?? 0
    payload.presence_penalty = options.presencePenalty ?? 0
  }

  return {
    payload,
    headers: {}
  }
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

function extractSseEventPayload(rawEvent = '') {
  const lines = String(rawEvent || '').split(/\r?\n/)
  const payloadLines = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue
    }

    if (line.startsWith('data:')) {
      payloadLines.push(line.slice(5).trimStart())
    }
  }

  return payloadLines.join('\n').trim()
}

function extractStreamDeltaText(chunk = {}) {
  const parts = []
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : []

  for (const choice of choices) {
    pushSequentialTextParts(choice?.delta?.content, parts)
    pushSequentialTextParts(choice?.delta?.text, parts)
  }

  if (parts.length === 0 && Array.isArray(chunk?.output)) {
    for (const item of chunk.output) {
      if (!/delta/i.test(String(item?.type || ''))) {
        continue
      }

      pushSequentialTextParts(item?.delta, parts)
      pushSequentialTextParts(item?.content, parts)
      pushSequentialTextParts(item?.text, parts)
    }
  }

  if (parts.length === 0) {
    const type = String(chunk?.type || '')
    if (type === 'response.output_text.delta' && typeof chunk.delta === 'string') {
      parts.push(chunk.delta)
    } else if (type === 'content_block_delta') {
      pushSequentialTextParts(chunk?.delta?.text, parts)
    }
  }

  if (parts.length === 0 && Array.isArray(chunk?.candidates)) {
    for (const candidate of chunk.candidates) {
      pushSequentialTextParts(candidate?.content?.parts, parts)
    }
  }

  return parts.join('')
}

function extractStreamSnapshotText(chunk = {}) {
  const parts = []
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : []

  for (const choice of choices) {
    pushSequentialTextParts(choice?.message?.content, parts)
    pushSequentialTextParts(choice?.message, parts)
  }

  if (parts.length === 0) {
    pushSequentialTextParts(chunk?.output_text, parts)
    pushSequentialTextParts(chunk?.content, parts)
    pushSequentialTextParts(chunk?.message?.content, parts)
  }

  return parts.join('')
}

function buildStreamResponseJson(state = {}) {
  const content = state.contentParts?.join('')
    || state.snapshotText
    || dedupeStrings(state.rawTextParts || []).join('\n')
  const citations = dedupeStrings(state.citations || [])
  const usage = extractResponseUsage(state.lastChunk || {})
    || (state.events || []).map(item => extractResponseUsage(item)).find(Boolean)
  const message = {
    role: 'assistant',
    content
  }

  if (citations.length > 0) {
    message.citations = citations
  }

  return {
    id: state.lastChunk?.id || '',
    object: state.lastChunk?.object || 'chat.completion',
    created: state.lastChunk?.created || Math.floor(Date.now() / 1000),
    model: state.lastChunk?.model || '',
    choices: [
      {
        index: 0,
        message,
        finish_reason: state.lastChunk?.choices?.[0]?.finish_reason || (state.done ? 'stop' : null)
      }
    ],
    output: state.events || [],
    ...(usage ? { usage } : {})
  }
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

function buildSplitImageHint(splitMetas = []) {
  if (!Array.isArray(splitMetas) || splitMetas.length === 0) {
    return ''
  }

  const sourceKeys = new Set()
  for (const meta of splitMetas) {
    const totalParts = Number(meta?.totalParts) || 0
    if (totalParts <= 1) {
      continue
    }

    sourceKeys.add(String(meta?.sourceKey || `${meta?.originalWidth || 0}x${meta?.originalHeight || 0}`))
  }

  if (sourceKeys.size === 0) {
    return ''
  }

  return `补充说明：其中 ${sourceKeys.size} 张超长图片已自动拆成 ${splitMetas.length} 个连续片段，片段顺序与原图一致并按从上到下排列，相邻片段可能有少量重叠。请把同一长图的相邻片段连续理解，不要当作互不相关的多张图片。`
}

function formatVideoTimePoint(seconds = 0) {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainSeconds = Math.floor(safeSeconds % 60)

  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
}

function buildVideoSegmentLabel(media = {}, index = 0) {
  const meta = media?.videoProcessMeta || {}
  const totalSegments = Number(meta?.totalSegments) || 1
  const label = media?.summaryMediaLabel || `视频${index}`
  if (totalSegments <= 1) {
    return label
  }

  const startSeconds = Number(meta?.startSeconds) || 0
  const endSeconds = Math.max(startSeconds, Number(meta?.endSeconds) || startSeconds)
  return `${label}：同一原视频的第 ${Number(meta?.segmentIndex) || 1}/${totalSegments} 段，时间范围 ${formatVideoTimePoint(startSeconds)}-${formatVideoTimePoint(endSeconds)}`
}

function buildVideoFrameLabel(media = {}, videoIndex = 0, frameIndex = 0, frameCount = 0, localSeconds = 0) {
  const meta = media?.videoProcessMeta || {}
  const totalSegments = Number(meta?.totalSegments) || 1
  const segmentIndex = Number(meta?.segmentIndex) || 1
  const globalSeconds = (Number(meta?.startSeconds) || 0) + (Number(localSeconds) || 0)
  const frameText = `第 ${frameIndex}/${frameCount} 帧，约 ${formatVideoTimePoint(globalSeconds)}`
  const label = media?.summaryMediaLabel || `视频${videoIndex}`

  if (totalSegments <= 1) {
    return `${label}：${frameText}`
  }

  return `${label}：原视频第 ${segmentIndex}/${totalSegments} 段，${frameText}`
}

function buildVideoSceneFrameLabel(media = {}, videoIndex = 0, frameIndex = 0, frameCount = 0) {
  const meta = media?.videoProcessMeta || {}
  const totalSegments = Number(meta?.totalSegments) || 1
  const segmentIndex = Number(meta?.segmentIndex) || 1
  const label = media?.summaryMediaLabel || `视频${videoIndex}`
  const frameText = `场景变化关键帧 ${frameIndex}/${frameCount}`

  if (totalSegments <= 1) {
    return `${label}：${frameText}`
  }

  return `${label}：原视频第 ${segmentIndex}/${totalSegments} 段，${frameText}`
}

function buildSplitVideoHint(videoFiles = []) {
  const groups = new Map()

  for (const media of videoFiles) {
    const meta = media?.videoProcessMeta || {}
    const totalSegments = Number(meta?.totalSegments) || 1
    if (totalSegments <= 1) {
      continue
    }

    const sourceKey = String(meta?.sourceKey || media?.url || media?.localPath || '')
    if (!sourceKey) {
      continue
    }

    if (!groups.has(sourceKey)) {
      groups.set(sourceKey, {
        totalSegments,
        segments: []
      })
    }

    groups.get(sourceKey).segments.push(Number(meta?.segmentIndex) || 1)
  }

  if (groups.size === 0) {
    return ''
  }

  const descriptions = []
  let groupIndex = 0

  for (const group of groups.values()) {
    groupIndex += 1
    const segmentText = [...new Set(group.segments)]
      .sort((left, right) => left - right)
      .join('、')
    descriptions.push(
      `原视频${groupIndex}已被拆成 ${group.totalSegments} 段，当前批次包含第 ${segmentText} 段`
    )
  }

  return `补充说明：${descriptions.join('；')}。请把同一原视频的多个分段按顺序连续理解，不要当成互不相关的独立视频。`
}

function getVideoSourceKey(media = {}, fallbackIndex = 0) {
  return String(
    media?.videoProcessMeta?.sourceKey
    || media?.url
    || media?.localPath
    || `video-${fallbackIndex}`
  )
}

function buildVideoBatches(videoFiles = [], batchLimit = 3) {
  const actualBatchLimit = Math.max(1, Number(batchLimit) || 1)
  const usableFiles = (videoFiles || []).filter(
    media => media?.type === 'video' && media?.localPath && fs.existsSync(media.localPath)
  )

  if (usableFiles.length === 0) {
    return []
  }

  const groups = []
  let previousKey = ''

  for (let index = 0; index < usableFiles.length; index += 1) {
    const media = usableFiles[index]
    const sourceKey = getVideoSourceKey(media, index)
    if (groups.length === 0 || sourceKey !== previousKey) {
      groups.push([media])
      previousKey = sourceKey
      continue
    }

    groups[groups.length - 1].push(media)
  }

  const batches = []
  let currentBatch = []

  const pushCurrentBatch = () => {
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
    }
  }

  for (const group of groups) {
    if (group.length > actualBatchLimit) {
      pushCurrentBatch()
      for (let offset = 0; offset < group.length; offset += actualBatchLimit) {
        batches.push(group.slice(offset, offset + actualBatchLimit))
      }
      continue
    }

    if (currentBatch.length > 0 && currentBatch.length + group.length > actualBatchLimit) {
      pushCurrentBatch()
    }

    currentBatch.push(...group)
  }

  pushCurrentBatch()
  return batches
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

function escapeRegExp(text = '') {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanIntentText(value = '') {
  return String(value || '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeIntentBoolean(value) {
  if (typeof value === 'boolean') {
    return value
  }

  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (['true', '1', 'yes', 'y', '是', '已使用', '使用了', '使用'].includes(normalized)) {
    return true
  }

  if (['false', '0', 'no', 'n', '否', '未使用', '没有使用', '未用'].includes(normalized)) {
    return false
  }

  return false
}

function extractLooseFieldValue(text = '', keys = []) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/^\s*>\s?/, '').replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)

  for (const line of lines) {
    for (const key of keys) {
      const pattern = new RegExp(`^${escapeRegExp(key)}\\s*[:：]\\s*(.+)$`, 'i')
      const match = line.match(pattern)
      if (match?.[1]) {
        return cleanIntentText(match[1])
      }
    }
  }

  return ''
}

function parseLooseSearchIntentContent(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return null
  }

  const cleaned = normalized.replace(/^\s*>\s?/gm, '').trim()
  const jsonParsed = parseJsonContent(cleaned, null)
  if (jsonParsed && typeof jsonParsed === 'object' && !Array.isArray(jsonParsed)) {
    return jsonParsed
  }

  const query = extractLooseFieldValue(cleaned, ['query', '搜索查询', '搜索词', '查询词', '查询'])
  const displayKeyword = extractLooseFieldValue(cleaned, ['displayKeyword', 'displaykeyword', 'keyword', 'display', '关键词', '关键字', '核心对象', '核心主题'])
  const useContextRaw = extractLooseFieldValue(cleaned, ['useContext', 'usecontext', 'usedContext', 'usedcontext', '是否使用上下文', '使用上下文'])

  if (!query && !displayKeyword && !useContextRaw) {
    return null
  }

  return {
    ...(query ? { query } : {}),
    ...(displayKeyword ? { displayKeyword } : {}),
    ...(useContextRaw ? { useContext: normalizeIntentBoolean(useContextRaw) } : {})
  }
}

function stripSearchContextNoise(text = '') {
  return String(text || '')
    .replace(/\[(?:图片|视频|语音|表情|群文件|文件:[^\]]+|文档:[^\]]+|转发消息[^\]]*)\]/g, ' ')
    .replace(/@\d{5,12}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeJsonPayload(text = '') {
  const normalized = String(text || '').trim()
  if (!normalized) {
    return false
  }

  return /^[{\[]/.test(normalized) && /"\w+"\s*:/.test(normalized)
}

function isAmbiguousSearchText(text = '') {
  const normalized = cleanIntentText(text)
    .replace(/[\s,.!?;:，。！？；：、"'`“”‘’（）()【】\[\]<>《》]/g, '')
    .toLowerCase()

  if (!normalized) {
    return true
  }

  if (normalized.length > 24) {
    return false
  }

  let stripped = normalized
  const fillerPatterns = [
    /这又是啥/g,
    /这又是谁/g,
    /这又是什么/g,
    /这是什么东西/g,
    /那是什么东西/g,
    /这个东西/g,
    /那个东西/g,
    /这东西/g,
    /那东西/g,
    /这个人/g,
    /那个人/g,
    /这张图/g,
    /那张图/g,
    /这个图/g,
    /那个图/g,
    /这个角色/g,
    /那个角色/g,
    /这个人物/g,
    /那个人物/g,
    /上面这个/g,
    /上面那个/g,
    /前面那个/g,
    /刚才那个/g,
    /引用消息/g,
    /回复消息/g,
    /这个/g,
    /那个/g,
    /这是/g,
    /那是/g,
    /这又/g,
    /那又/g,
    /什么东西/g,
    /是什么/g,
    /是啥/g,
    /是谁/g,
    /什么/g,
    /谁/g,
    /啥/g,
    /图片/g,
    /照片/g,
    /图/g,
    /视频/g,
    /语音/g,
    /消息/g,
    /回复/g,
    /引用/g,
    /这个玩意儿/g,
    /那个玩意儿/g,
    /玩意儿/g,
    /玩意/g,
    /这位/g,
    /那位/g,
    /他/g,
    /她/g,
    /它/g,
    /ta/g,
    /又/g,
    /这/g,
    /那/g
  ]

  for (const pattern of fillerPatterns) {
    stripped = stripped.replace(pattern, '')
  }

  return stripped.length === 0
}

function extractMediaSupplementCandidates(text = '') {
  const candidates = []
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/(?:\[[^\]]*媒体补充\]\s*)?(?:图片内容|视频内容|语音内容|媒体内容)\s*[：:]\s*(.+)$/)
    const candidate = cleanIntentText(match?.[1] || '')
    if (!candidate || looksLikeJsonPayload(candidate)) {
      continue
    }
    candidates.push(candidate)
  }

  return candidates
}

function extractContextBodyCandidate(text = '') {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const bodyLines = []

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index]
    if (index === 0) {
      line = line.replace(/^\[[^\]]+\]\s*/, '').trim()
    }

    if (!line) {
      continue
    }
    if (/^\[[^\]]*媒体补充\]/.test(line)) {
      continue
    }
    if (/^(?:图片内容|视频内容|语音内容|媒体内容)\s*[：:]/.test(line)) {
      continue
    }
    if (looksLikeJsonPayload(line)) {
      continue
    }

    bodyLines.push(line)
  }

  const candidate = cleanIntentText(stripSearchContextNoise(bodyLines.join(' ')))
  if (!candidate || looksLikeJsonPayload(candidate) || isAmbiguousSearchText(candidate)) {
    return ''
  }

  return candidate
}

function pickDisplayKeywordFromCandidate(text = '') {
  const cleaned = cleanIntentText(stripSearchContextNoise(text))
  if (!cleaned) {
    return ''
  }

  const segments = cleaned
    .split(/[，,、/；;|。]/)
    .map(item => cleanIntentText(item))
    .filter(Boolean)

  const genericPattern = /^(?:图片|视频|语音|角色|人物|动漫人物|游戏截图|截图|界面|消息|文本|内容|场景|主体|台词|字幕|附件|文件)$/
  const preferred = segments.find(item => item.length >= 2 && !genericPattern.test(item))
    || segments[0]
    || cleaned

  return preferred.slice(0, 40)
}

function buildSearchIntentFallback(question = '', context = {}) {
  const currentQuestion = cleanIntentText(question)
  const sources = [
    String(context?.replyText || '').trim(),
    ...(Array.isArray(context?.replyNearbyTexts) ? context.replyNearbyTexts : []),
    ...(Array.isArray(context?.historyTexts) ? context.historyTexts : [])
  ].filter(Boolean)

  const candidates = []
  for (const source of sources) {
    candidates.push(...extractMediaSupplementCandidates(source))

    const bodyCandidate = extractContextBodyCandidate(source)
    if (bodyCandidate) {
      candidates.push(bodyCandidate)
    }
  }

  const uniqueCandidates = dedupeStrings(candidates).filter(item => !isAmbiguousSearchText(item))
  if (uniqueCandidates.length === 0) {
    return null
  }

  const query = uniqueCandidates[0]
  const displayKeyword = pickDisplayKeywordFromCandidate(query) || extractKeyword(query) || currentQuestion || query
  return {
    query,
    displayKeyword,
    useContext: true,
    fallbackSource: query === uniqueCandidates[0] && extractMediaSupplementCandidates(String(context?.replyText || '')).includes(query)
      ? 'replyMedia'
      : 'contextText'
  }
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

function hasUsableImageFiles(imageFiles = []) {
  return (imageFiles || []).some(
    media => media?.type === 'image' && media?.localPath && fs.existsSync(media.localPath)
  )
}

async function loadUndiciAgent() {
  if (!undiciAgentPromise) {
    undiciAgentPromise = import('undici')
      .then(mod => mod.Agent)
      .catch(() => null)
  }

  return undiciAgentPromise
}

class ApiService {
  isPenaltyUnsupportedModel(model = '') {
    return /grok-(3|4)/i.test(String(model || ''))
  }

  normalizeFallbackRequestMode(value, fallback = 'inherit') {
    const normalized = String(value || '').trim().toLowerCase()
    return ['inherit', 'response', 'stream'].includes(normalized) ? normalized : fallback
  }

  normalizeFallbackEndpointType(value, fallback = 'inherit') {
    const normalized = normalizeEndpointType(value, fallback)
    return ['inherit', 'openai-chat', 'openai-responses', 'anthropic-messages'].includes(normalized) ? normalized : fallback
  }

  normalizeEndpointType(value, fallback = 'openai-chat') {
    const normalized = normalizeEndpointType(value, fallback)
    return normalized === 'inherit' ? fallback : normalized
  }

  normalizeRequestMode(value, fallback = 'response') {
    const normalized = String(value || '').trim().toLowerCase()
    return ['response', 'stream'].includes(normalized) ? normalized : fallback
  }

  normalizeTimeoutMs(value, fallback = 120000) {
    const timeoutMs = Number(value)
    if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
      return Math.min(600000, Math.floor(timeoutMs))
    }
    return fallback
  }

  normalizeConnectTimeoutMs(value, fallback = DEFAULT_CONNECT_TIMEOUT_MS) {
    const timeoutMs = Number(value)
    if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
      return Math.min(600000, Math.floor(timeoutMs))
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

  normalizeFallbackModels(value = []) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => ({
        model: String(item?.model || '').trim(),
        baseUrl: String(item?.baseUrl || '').trim(),
        apiKey: String(item?.apiKey || '').trim(),
        endpointType: this.normalizeFallbackEndpointType(item?.endpointType, 'inherit'),
        requestMode: this.normalizeFallbackRequestMode(item?.requestMode, 'inherit')
      }))
      .filter(item => item.model || item.baseUrl || item.apiKey)
  }

  getModelConfigCandidates(modelType, options = {}) {
    const apiConfig = Config.get('api', {})
    const modelConfig = apiConfig?.[modelType] || {}
    const requestTimeout = this.normalizeTimeoutMs(options.timeoutMs ?? options.timeout, this.normalizeTimeoutMs(modelConfig.timeoutMs, 120000))
    const connectTimeout = this.normalizeConnectTimeoutMs(
      options.connectTimeoutMs,
      this.normalizeConnectTimeoutMs(modelConfig.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
    )
    const maxRetries = this.normalizeRetryCount(options.retryCount, this.normalizeRetryCount(modelConfig.retryCount, 0))
    const primaryEndpointType = this.normalizeEndpointType(options.endpointType, modelConfig.endpointType || 'openai-chat')
    const primaryRequestMode = this.normalizeRequestMode(options.requestMode, modelConfig.requestMode || 'response')
    const inheritedBaseUrl = (modelConfig.baseUrl || apiConfig.primaryBaseUrl || '').replace(/\/$/, '')
    const inheritedApiKey = modelConfig.apiKey || apiConfig.primaryApiKey || ''

    const rawCandidates = [
      {
        label: '主模型',
        source: 'primary',
        model: String(modelConfig.model || '').trim(),
        baseUrl: String(modelConfig.baseUrl || '').trim(),
        apiKey: String(modelConfig.apiKey || '').trim(),
        endpointType: primaryEndpointType,
        requestMode: primaryRequestMode
      },
      ...this.normalizeFallbackModels(modelConfig.fallbackModels).map((item, index) => ({
        ...item,
        label: `下级模型${index + 1}`,
        source: 'fallback',
        order: index + 1
      }))
    ]

    return rawCandidates.map((candidate, index) => {
      const requestMode = candidate.source === 'fallback' && candidate.requestMode === 'inherit'
        ? primaryRequestMode
        : this.normalizeRequestMode(candidate.requestMode, primaryRequestMode)
      const endpointType = candidate.source === 'fallback' && candidate.endpointType === 'inherit'
        ? primaryEndpointType
        : this.normalizeEndpointType(candidate.endpointType, primaryEndpointType)
      const baseUrl = (candidate.baseUrl || inheritedBaseUrl).replace(/\/$/, '')
      const apiKey = candidate.apiKey || inheritedApiKey
      const model = String(candidate.model || '').trim()
      const valid = Boolean(baseUrl && apiKey && model)

      return {
        ...candidate,
        index,
        total: rawCandidates.length,
        model,
        baseUrl,
        apiKey,
        endpointType,
        requestMode,
        timeoutMs: requestTimeout,
        connectTimeoutMs: connectTimeout,
        retryCount: maxRetries,
        valid
      }
    })
  }

  isRetryableStatus(status) {
    return [408, 409, 425, 429].includes(status) || status >= 500
  }

  getErrorSignalText(error) {
    const parts = []
    const seen = new Set()
    let current = error

    while (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current)
      parts.push(current.name, current.code, current.message)
      current = current.cause
    }

    return parts.filter(Boolean).join(' ')
  }

  formatErrorWithCause(error) {
    const message = String(error?.message || error || '未知错误')
    const cause = error?.cause
    if (!cause) {
      return message
    }

    const causeCode = cause.code ? `${cause.code}: ` : ''
    const causeMessage = String(cause.message || cause || '').trim()
    return causeMessage ? `${message}（cause: ${causeCode}${causeMessage}）` : message
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

    const signalText = this.getErrorSignalText(error)
    return /fetch failed|timeout|timed out|econnreset|econnrefused|enotfound|eai_again|etimedout|econnaborted|epipe|socket hang up|network socket disconnected|und_err_connect_timeout|und_err_socket/i.test(signalText)
  }

  isConnectionResetError(error) {
    return /econnreset|network socket disconnected|und_err_socket/i.test(this.getErrorSignalText(error))
  }

  getRetryDelayMs(attempt, error = null) {
    if (this.isConnectionResetError(error)) {
      return Math.min(15000, 3000 * (2 ** attempt))
    }

    return Math.min(5000, 1200 * (attempt + 1))
  }

  resetFetchDispatcher(connectTimeoutMs) {
    const normalizedTimeout = this.normalizeConnectTimeoutMs(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
    const dispatcher = fetchDispatcherCache.get(normalizedTimeout)
    if (dispatcher) {
      try {
        dispatcher.destroy?.()
      } catch {}
      fetchDispatcherCache.delete(normalizedTimeout)
    }
  }

  async getFetchDispatcher(connectTimeoutMs) {
    const Agent = await loadUndiciAgent()
    if (!Agent) {
      if (!undiciUnavailableWarned) {
        logger.warn(`[${pluginName}] 未找到 undici 依赖，连接阶段超时将使用 Node fetch 默认值`)
        undiciUnavailableWarned = true
      }
      return null
    }

    const normalizedTimeout = this.normalizeConnectTimeoutMs(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
    if (!fetchDispatcherCache.has(normalizedTimeout)) {
      fetchDispatcherCache.set(normalizedTimeout, new Agent({
        connect: {
          timeout: normalizedTimeout
        }
      }))
    }

    return fetchDispatcherCache.get(normalizedTimeout)
  }

  getMediaAnalysisCacheKey(kind = 'media', payload = {}) {
    return `media:${kind}:${hashText(JSON.stringify(payload || {}))}`
  }

  tryGetMediaAnalysisCache(cacheKey = '', label = '媒体理解') {
    if (!cacheKey) {
      return null
    }

    const cached = resultCache.get(cacheKey, Config.get('cache', {}))
    if (cached?.data) {
      debugLog('api.mediaCache', `${label}命中缓存`, { cacheKey })
      return cached.data
    }

    return null
  }

  setMediaAnalysisCache(cacheKey = '', value = null) {
    if (!cacheKey || !value) {
      return
    }

    resultCache.set(cacheKey, value, Config.get('cache', {}))
  }

  getVideoImageModelConfig() {
    const config = Config.get('fileRequest.videoPreprocess', {})
    const strategy = String(config?.imageFrameStrategy || '').trim().toLowerCase()
    return {
      enabled: config?.useImageModel === true,
      framesPerSegment: clampNumber(config?.imageFramesPerSegment, 1, 8, 4),
      frameStrategy: ['uniform', 'scene'].includes(strategy) ? strategy : 'uniform',
      sceneThreshold: clampFloat(config?.imageSceneThreshold, 0.05, 0.8, 0.25),
      maxOutputWidth: 1280,
      ffmpegTimeoutMs: 60000
    }
  }

  getApiTempDir() {
    const tempDir = path.join(process.cwd(), 'temp', pluginName)
    fs.mkdirSync(tempDir, { recursive: true })
    return tempDir
  }

  createApiTempPath(prefix = 'media', ext = '.tmp') {
    const tempDir = this.getApiTempDir()
    return path.join(
      tempDir,
      `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    )
  }

  cleanupTempFiles(files = []) {
    for (const file of files) {
      const filePath = typeof file === 'string' ? file : file?.localPath
      if (!filePath) {
        continue
      }

      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 清理视频抽帧临时文件失败：${error.message}`)
      }
    }
  }

  async extractVideoFrameImage(videoFile, outputPath, seekSeconds, config = this.getVideoImageModelConfig()) {
    await execFile('ffmpeg', [
      '-v', 'error',
      '-ss', Math.max(0, Number(seekSeconds) || 0).toFixed(3),
      '-i', videoFile,
      '-frames:v', '1',
      '-vf', `scale='min(iw,${config.maxOutputWidth})':-2:force_original_aspect_ratio=decrease`,
      '-q:v', '3',
      '-y',
      outputPath
    ], {
      windowsHide: true,
      timeout: config.ffmpegTimeoutMs
    })

    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0
  }

  async extractSceneVideoFrameImages(videoFile, config = this.getVideoImageModelConfig()) {
    const tempDir = this.getApiTempDir()
    const stem = `video_scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const pattern = path.join(tempDir, `${stem}_%03d.png`)

    try {
      await execFile('ffmpeg', [
        '-v', 'error',
        '-i', videoFile,
        '-vf', `select=gt(scene\\,${config.sceneThreshold}),scale='min(iw,${config.maxOutputWidth})':-2:force_original_aspect_ratio=decrease`,
        '-fps_mode', 'vfr',
        '-frames:v', String(config.framesPerSegment),
        '-y',
        pattern
      ], {
        windowsHide: true,
        timeout: config.ffmpegTimeoutMs
      })

      return fs.readdirSync(tempDir)
        .filter(file => file.startsWith(`${stem}_`) && file.endsWith('.png'))
        .sort()
        .map(file => path.join(tempDir, file))
        .filter(file => fs.existsSync(file) && fs.statSync(file).size > 0)
    } catch (error) {
      const files = fs.existsSync(tempDir)
        ? fs.readdirSync(tempDir)
          .filter(file => file.startsWith(`${stem}_`) && file.endsWith('.png'))
          .map(file => path.join(tempDir, file))
        : []
      this.cleanupTempFiles(files)
      throw error
    }
  }

  async extractVideoFramesForImageModel(videoFiles = [], config = this.getVideoImageModelConfig()) {
    const imageFiles = []
    let videoIndex = 0

    for (const media of videoFiles || []) {
      if (media?.type !== 'video' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      videoIndex += 1
      const meta = media?.videoProcessMeta || {}
      const durationSeconds = Math.max(0, Number(meta?.durationSeconds) || 0)
      const framesPerSegment = durationSeconds > 0 && durationSeconds < 2
        ? 1
        : config.framesPerSegment

      if (config.frameStrategy === 'scene' && durationSeconds >= 2) {
        try {
          const sceneFrames = await this.extractSceneVideoFrameImages(media.localPath, {
            ...config,
            framesPerSegment
          })
          if (sceneFrames.length > 0) {
            for (let frameIndex = 0; frameIndex < sceneFrames.length; frameIndex += 1) {
              imageFiles.push({
                type: 'image',
                localPath: sceneFrames[frameIndex],
                url: media.url,
                name: media.name || '',
                summaryMediaLabel: media.summaryMediaLabel,
                imagePromptLabel: buildVideoSceneFrameLabel(media, videoIndex, frameIndex + 1, sceneFrames.length),
                videoFrameMeta: {
                  videoIndex,
                  frameIndex: frameIndex + 1,
                  frameCount: sceneFrames.length,
                  frameStrategy: 'scene',
                  sourceKey: meta?.sourceKey || media.url || media.localPath || ''
                }
              })
            }
            continue
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 视频场景变化抽帧失败，已回退均匀抽帧：${error.message}`)
        }
      }

      for (let frameIndex = 1; frameIndex <= framesPerSegment; frameIndex += 1) {
        const seekSeconds = durationSeconds > 0
          ? Math.min(Math.max(0, durationSeconds - 0.05), durationSeconds * frameIndex / (framesPerSegment + 1))
          : 0
        const outputPath = this.createApiTempPath('video_frame', '.jpg')

        try {
          const ok = await this.extractVideoFrameImage(media.localPath, outputPath, seekSeconds, config)
          if (!ok) {
            this.cleanupTempFiles([outputPath])
            continue
          }

          imageFiles.push({
            type: 'image',
            localPath: outputPath,
            url: media.url,
            name: media.name || '',
            summaryMediaLabel: media.summaryMediaLabel,
            imagePromptLabel: buildVideoFrameLabel(media, videoIndex, frameIndex, framesPerSegment, seekSeconds),
            videoFrameMeta: {
              videoIndex,
              frameIndex,
              frameCount: framesPerSegment,
              frameStrategy: 'uniform',
              localSeconds: seekSeconds,
              globalSeconds: (Number(meta?.startSeconds) || 0) + seekSeconds,
              sourceKey: meta?.sourceKey || media.url || media.localPath || ''
            }
          })
        } catch (error) {
          this.cleanupTempFiles([outputPath])
          logger.warn(`[${pluginName}] 视频抽帧失败：${error.message}`)
        }
      }
    }

    return imageFiles
  }

  createAbortTimer(controller, timeoutMs) {
    let timeoutId = null
    const reset = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    }

    const clear = () => {
      clearTimeout(timeoutId)
    }

    reset()
    return { reset, clear }
  }

  async readStreamedChatCompletion(response, modelType, onActivity = null) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('text/event-stream')) {
      const text = await response.text()
      return {
        text,
        json: parseJson(text, `${modelType} 响应`)
      }
    }

    const reader = response.body?.getReader?.()
    if (!reader) {
      const text = await response.text()
      return {
        text,
        json: parseJson(text, `${modelType} 响应`)
      }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const state = {
      contentParts: [],
      snapshotText: '',
      rawTextParts: [],
      citations: [],
      events: [],
      lastChunk: null,
      done: false
    }

    const processEvent = rawEvent => {
      const payload = extractSseEventPayload(rawEvent)
      if (!payload) {
        return
      }

      if (payload === '[DONE]') {
        state.done = true
        return
      }

      const chunk = parseJsonContent(payload, null)
      if (!chunk || typeof chunk !== 'object') {
        state.rawTextParts.push(payload)
        return
      }

      if (chunk.error) {
        throw new Error(
          typeof chunk.error === 'string'
            ? chunk.error
            : (chunk.error?.message || JSON.stringify(chunk.error))
        )
      }

      state.events.push(chunk)
      state.lastChunk = chunk
      pushCitationUrls(chunk, state.citations)

      const deltaText = extractStreamDeltaText(chunk)
      if (deltaText) {
        state.contentParts.push(deltaText)
        return
      }

      const snapshotText = extractStreamSnapshotText(chunk)
      if (snapshotText) {
        state.snapshotText = snapshotText
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (typeof onActivity === 'function') {
        onActivity()
      }

      buffer += decoder.decode(value, { stream: true })
      let match = buffer.match(/\r?\n\r?\n/)
      while (match) {
        const boundaryIndex = match.index ?? -1
        const separatorLength = match[0].length
        if (boundaryIndex < 0) {
          break
        }

        const rawEvent = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + separatorLength)
        processEvent(rawEvent)
        match = buffer.match(/\r?\n\r?\n/)
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      processEvent(buffer)
    }

    const json = buildStreamResponseJson(state)
    return {
      text: extractResponseText(json) || dedupeStrings(state.rawTextParts || []).join('\n'),
      json
    }
  }

  async requestChatCompletion(modelType, messages, options = {}) {
    const candidates = this.getModelConfigCandidates(modelType, options)
    const validCandidates = candidates.filter(item => item.valid)

    for (const skipped of candidates.filter(item => !item.valid)) {
      logger.warn(
        `[${pluginName}] ${modelType} ${skipped.label}配置不完整，已跳过降级候选：model=${skipped.model || '未填写'}`
      )
    }

    if (validCandidates.length === 0) {
      throw new Error(`${modelType} 模型配置不完整，请检查锅巴面板或配置文件`)
    }

    let lastError = null

    for (let candidateIndex = 0; candidateIndex < validCandidates.length; candidateIndex += 1) {
      const candidate = validCandidates[candidateIndex]
      const requestTimeout = candidate.timeoutMs
      const connectTimeout = candidate.connectTimeoutMs
      const maxRetries = candidate.retryCount
      const actualRequestMode = this.normalizeRequestMode(candidate.requestMode, 'response')

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController()
        const timer = this.createAbortTimer(controller, requestTimeout)

        try {
          debugLog('api.request', `准备请求 ${modelType}`, {
            baseUrl: candidate.baseUrl,
            model: candidate.model,
            endpointType: candidate.endpointType,
            requestMode: actualRequestMode,
            timeout: requestTimeout,
            connectTimeout,
            retryCount: maxRetries,
            attempt: attempt + 1,
            candidateIndex: candidateIndex + 1,
            candidateCount: validCandidates.length,
            candidateLabel: candidate.label,
            messageCount: Array.isArray(messages) ? messages.length : 0
          })

          const endpointRequest = buildEndpointRequest(candidate, messages, options, actualRequestMode)

          const fetchOptions = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(candidate.endpointType === 'anthropic-messages'
                ? { 'x-api-key': candidate.apiKey }
                : candidate.endpointType === 'gemini-native'
                  ? { Authorization: `Bearer ${candidate.apiKey}`, 'x-goog-api-key': candidate.apiKey }
                  : { Authorization: `Bearer ${candidate.apiKey}` }),
              ...endpointRequest.headers
            },
            body: JSON.stringify(endpointRequest.payload),
            signal: controller.signal
          }
          const dispatcher = await this.getFetchDispatcher(connectTimeout)
          if (dispatcher) {
            fetchOptions.dispatcher = dispatcher
          }

          const response = await fetch(appendEndpointPath(candidate.baseUrl, candidate.endpointType, candidate.model, actualRequestMode), fetchOptions)

          if (!response.ok) {
            const text = await response.text()
            debugLog('api.response', `${modelType} 响应`, {
              ok: response.ok,
              status: response.status,
              endpointType: candidate.endpointType,
              requestMode: actualRequestMode,
              attempt: attempt + 1,
              candidateIndex: candidateIndex + 1,
              candidateCount: validCandidates.length,
              candidateLabel: candidate.label,
              preview: text.slice(0, 200)
            })
            const error = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
            error.status = response.status
            error.retryable = this.isRetryableStatus(response.status)
            throw error
          }

          const result = actualRequestMode === 'stream'
            ? await this.readStreamedChatCompletion(response, modelType, () => timer.reset())
            : {
                text: await response.text(),
                json: null
              }

          if (!result.json) {
            result.json = parseJson(result.text, `${modelType} 响应`)
          }

          debugLog('api.response', `${modelType} 响应`, {
            ok: response.ok,
            status: response.status,
            endpointType: candidate.endpointType,
            requestMode: actualRequestMode,
            attempt: attempt + 1,
            candidateIndex: candidateIndex + 1,
            candidateCount: validCandidates.length,
            candidateLabel: candidate.label,
            preview: String(result.text || '').slice(0, 200)
          })

          return {
            ...result,
            usage: extractResponseUsage(result.json),
            candidate: {
              index: candidateIndex + 1,
              total: validCandidates.length,
              label: candidate.label,
              model: candidate.model,
              endpointType: candidate.endpointType,
              requestMode: actualRequestMode,
              isFallback: candidate.source === 'fallback'
            }
          }
        } catch (error) {
          lastError = error
          const shouldRetry = attempt < maxRetries && this.isRetryableError(error)
          if (!shouldRetry) {
            break
          }

          if (this.isConnectionResetError(error)) {
            this.resetFetchDispatcher(connectTimeout)
          }

          const delayMs = this.getRetryDelayMs(attempt, error)
          logger.warn(
            `[${pluginName}] ${modelType} ${candidate.label}(${candidate.model}) 请求失败，${delayMs}ms 后进行第 ${attempt + 2} 次尝试：${this.formatErrorWithCause(error)}`
          )
          await sleep(delayMs)
        } finally {
          timer.clear()
        }
      }

      const nextCandidate = validCandidates[candidateIndex + 1]
      if (nextCandidate) {
        logger.warn(
          `[${pluginName}] ${modelType} ${candidate.label}(${candidate.model}) 请求失败，自动降级到 ${nextCandidate.label}(${nextCandidate.model})：${this.formatErrorWithCause(lastError)}`
        )
      }
    }

    throw lastError || new Error(`${modelType} 请求失败：所有模型候选均不可用`)
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

  async callSummaryTextAPI(content, systemPromptOverride = null, options = {}) {
    const promptConfig = Config.get('prompt', {})
    const actualContent = String(content || '').trim()
    if (!actualContent) {
      return null
    }

    const response = await this.requestChatCompletion('summary', [
      { role: 'system', content: systemPromptOverride || promptConfig.summaryDefault || '' },
      { role: 'user', content: actualContent }
    ], options)

    const result = extractResponseText(response.json) || null
    if (!result) {
      return null
    }
    const text = options.beautify === false ? result.trim() : beautifyText(result)
    if (options.returnMeta) {
      return {
        text,
        usage: response.usage || null,
        candidate: response.candidate || null
      }
    }
    return text
  }

  async callImageAPI(content, imageFiles = [], systemPromptOverride = null) {
    const promptConfig = Config.get('prompt', {})
    const userContent = []
    const splitMetas = []
    const cacheParts = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    let imageCount = 0
    for (const media of imageFiles) {
      if (media.type !== 'image' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      const buffer = fs.readFileSync(media.localPath)
      const mediaHash = hashBuffer(buffer)
      const base64 = buffer.toString('base64')
      const mimeType = getImageMimeType(media.localPath)
      if (mimeType === 'image/gif') {
        logger.warn(`[${pluginName}] 检测到未静态化的 GIF，已跳过：${media.localPath}`)
        continue
      }
      const imagePromptLabel = media.imagePromptLabel || media.summaryMediaLabel
      if (imagePromptLabel) {
        userContent.push({
          type: 'text',
          text: String(imagePromptLabel)
        })
      }
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      })
      if (media?.splitMeta?.totalParts > 1) {
        splitMetas.push(media.splitMeta)
      }
      cacheParts.push({
        hash: mediaHash,
        label: media.imagePromptLabel || media.summaryMediaLabel || '',
        splitMeta: media.splitMeta || null
      })
      imageCount += 1
    }

    const splitHint = buildSplitImageHint(splitMetas)
    if (splitHint) {
      userContent.splice(content ? 1 : 0, 0, { type: 'text', text: splitHint })
    }

    if (userContent.length === 0) {
      return null
    }

    let systemPrompt = systemPromptOverride || promptConfig.summaryDefault || ''
    if (!systemPromptOverride && imageCount > 0) {
      systemPrompt += (promptConfig.summaryImageAppend || '').replace('{count}', imageCount)
    }

    const cacheKey = this.getMediaAnalysisCacheKey('image', {
      content,
      systemPrompt,
      images: cacheParts
    })
    const cachedResult = this.tryGetMediaAnalysisCache(cacheKey, '图片理解')
    if (cachedResult) {
      return cachedResult
    }

    const { json } = await this.requestChatCompletion('image', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ])

    const result = extractResponseText(json) || null
    const finalResult = result ? beautifyText(result) : null
    this.setMediaAnalysisCache(cacheKey, finalResult)
    return finalResult
  }

  async callTextImageAPI(content, imageFiles = [], systemPromptOverride = null) {
    if (hasUsableImageFiles(imageFiles)) {
      return this.callImageAPI(content, imageFiles, systemPromptOverride)
    }

    return this.callSummaryTextAPI(content, systemPromptOverride)
  }

  async callVideoByImageModelAPI(content, videoFiles = [], systemPromptOverride = null) {
    const promptConfig = Config.get('prompt', {})
    const config = this.getVideoImageModelConfig()
    const imageFiles = await this.extractVideoFramesForImageModel(videoFiles, config)

    if (imageFiles.length === 0) {
      return null
    }

    try {
      const prompt = [
        String(content || '').trim(),
        '以下图片是从视频片段中按时间顺序抽取的关键帧，每张图前都有对应的视频、片段和时间标签。',
        '请把这些关键帧当作同一视频时间线连续理解，概括主体、人物、场景、字幕、关键动作和可能的台词信息。',
        '如果同一原视频被拆成多段，请按段号和时间顺序整合，不要当成互不相关的独立图片。',
        '直接输出纯文本，不要使用 markdown，不要编造。'
      ].filter(Boolean).join('\n')

      return await this.callImageAPI(
        prompt,
        imageFiles,
        systemPromptOverride || promptConfig.video || ''
      )
    } finally {
      this.cleanupTempFiles(imageFiles)
    }
  }

  async callVideoAPI(content, videoFiles = [], systemPromptOverride = null, options = {}) {
    const promptConfig = Config.get('prompt', {})
    const fileConfig = Config.get('fileRequest', {})
    const requestedBatchLimit = Number(options.batchLimit)
    const batchLimit = requestedBatchLimit === 0
      ? 0
      : Math.max(1, requestedBatchLimit || Number(fileConfig.videoMaxPerRequest) || 1)
    const loopLimit = Math.max(1, Number(options.loopLimit) || Number(fileConfig.maxRequestLoops) || 1)
    const videoBatches = batchLimit > 0 ? buildVideoBatches(videoFiles, batchLimit) : []

    if (batchLimit > 0 && videoBatches.length > 1) {
      const actualBatches = Math.min(videoBatches.length, loopLimit)
      const results = []

      debugLog('api.videoBatch', '视频请求已自动分批', {
        inputCount: (videoFiles || []).length,
        batchLimit,
        totalBatches: videoBatches.length,
        actualBatches
      })

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = videoBatches[batch]
        const batchPrompt = [
          `这是第 ${batch + 1} / ${actualBatches} 批视频。`,
          String(content || '').trim()
        ].filter(Boolean).join('\n')

        const result = await this.callVideoAPI(
          batchPrompt,
          chunk,
          systemPromptOverride,
          {
            ...options,
            batchLimit: 0,
            loopLimit: 1
          }
        )

        if (result) {
          results.push(`【第${batch + 1}批视频分析】\n${result}`)
        }
      }

      return results.join('\n\n')
    }

    const imageModelConfig = this.getVideoImageModelConfig()
    if (imageModelConfig.enabled && options.forceVideoModel !== true) {
      try {
        const imageModelResult = await this.callVideoByImageModelAPI(content, videoFiles, systemPromptOverride)
        if (imageModelResult) {
          debugLog('api.videoImageModel', '视频已通过识图模型分析', {
            videoCount: (videoFiles || []).filter(item => item?.type === 'video').length,
            framesPerSegment: imageModelConfig.framesPerSegment
          })
          return imageModelResult
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 视频抽帧识图失败，已回退视频模型：${error.message}`)
      }
    }

    const userContent = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    const splitHint = buildSplitVideoHint(videoFiles)
    if (splitHint) {
      userContent.push({ type: 'text', text: splitHint })
    }

    let videoCount = 0
    const cacheParts = []
    for (const media of videoFiles) {
      if (media.type !== 'video' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      videoCount += 1
      userContent.push({
        type: 'text',
        text: buildVideoSegmentLabel(media, videoCount)
      })

      const buffer = fs.readFileSync(media.localPath)
      const mediaHash = hashBuffer(buffer)
      const base64 = buffer.toString('base64')
      userContent.push({
        type: 'video_url',
        video_url: {
          url: `data:video/mp4;base64,${base64}`
        }
      })
      cacheParts.push({
        hash: mediaHash,
        label: media.summaryMediaLabel || '',
        videoProcessMeta: media.videoProcessMeta || null
      })
    }

    if (videoCount === 0 || userContent.length === 0) {
      return null
    }

    const systemPrompt = systemPromptOverride || promptConfig.video || ''
    const cacheKey = this.getMediaAnalysisCacheKey('video', {
      content,
      systemPrompt,
      splitHint,
      videos: cacheParts
    })
    const cachedResult = this.tryGetMediaAnalysisCache(cacheKey, '视频理解')
    if (cachedResult) {
      return cachedResult
    }

    const { json } = await this.requestChatCompletion('video', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ])

    const result = extractResponseText(json) || null
    const finalResult = result ? beautifyText(result) : null
    this.setMediaAnalysisCache(cacheKey, finalResult)
    return finalResult
  }

  async callSummaryAPI(content, mediaFiles = []) {
    const fileConfig = Config.get('fileRequest', {})
    const imageFiles = mediaFiles.filter(item => item.type === 'image')
    const videoFiles = mediaFiles.filter(item => item.type === 'video')
    const mediaSections = []
    const normalizedContent = String(content || '').trim()

    if (imageFiles.length > 0) {
      const imageLimit = fileConfig.imageMaxPerRequest || 20
      const loopLimit = fileConfig.maxRequestLoops || 1
      const totalBatches = Math.ceil(imageFiles.length / imageLimit)
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = imageFiles.slice(batch * imageLimit, (batch + 1) * imageLimit)
        const prompt = [
          actualBatches > 1 ? `这是第 ${batch + 1} / ${actualBatches} 批图片。` : '',
          '请逐图观察这些图片，提取后续统一总结所需的关键信息。',
          '如果图片前带有类似 [M1 图片] 的编号，请在分析中保留该编号，方便后续按原消息顺序对应。',
          '优先描述主题、人物、场景、图片文字、表格内容、时间顺序和图片之间的上下文关系。',
          '如果多张图片属于同一长图或同一组内容，请按顺序整合理解。',
          '直接输出纯文本，不要使用 markdown，不要编造。'
        ].filter(Boolean).join('\n')
        try {
          const result = await this.callImageAPI(prompt, chunk)
          if (result) {
            mediaSections.push(actualBatches > 1 ? `【第${batch + 1}批图片分析】\n${result}` : `【图片分析】\n${result}`)
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 第 ${batch + 1} 批图片分析失败，已继续处理其他内容：${error.message}`)
          mediaSections.push(
            actualBatches > 1
              ? `【第${batch + 1}批图片处理说明】该批图片分析失败：${error.message}`
              : `【图片处理说明】图片分析失败：${error.message}`
          )
        }
      }
    }

    if (videoFiles.length > 0) {
      const videoLimit = fileConfig.videoMaxPerRequest || 3
      const loopLimit = fileConfig.maxRequestLoops || 1
      const videoBatches = buildVideoBatches(videoFiles, videoLimit)
      const totalBatches = videoBatches.length
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = videoBatches[batch]
        const prompt = [
          actualBatches > 1 ? `这是第 ${batch + 1} / ${actualBatches} 批视频。` : '',
          '请分析这些视频，提取后续统一总结所需的关键信息。',
          '如果视频前带有类似 [M2 视频] 的编号，请在分析中保留该编号，方便后续按原消息顺序对应。',
          '优先描述主题、人物、场景、字幕、关键动作和关键台词。',
          '如果同一原视频被拆成多段，请按顺序连续理解。',
          '直接输出纯文本，不要使用 markdown，不要编造。'
        ].filter(Boolean).join('\n')

        try {
          const result = await this.callVideoAPI(prompt, chunk, null, {
            batchLimit: 0,
            loopLimit: 1
          })
          if (result) {
            mediaSections.push(actualBatches > 1 ? `【第${batch + 1}批视频分析】\n${result}` : `【视频分析】\n${result}`)
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 第 ${batch + 1} 批视频分析失败，已继续处理其他内容：${error.message}`)
          mediaSections.push(
            actualBatches > 1
              ? `【第${batch + 1}批视频处理说明】该批视频分析失败：${error.message}`
              : `【视频处理说明】视频分析失败：${error.message}`
          )
        }
      }
    }

    if (!normalizedContent && mediaSections.length === 0) {
      return null
    }

    if (mediaSections.length === 0) {
      return this.callSummaryTextAPI(normalizedContent)
    }

    const finalPrompt = [
      normalizedContent,
      normalizedContent
        ? '以下是从图片和视频中提取出的补充信息，请与上文一起综合理解后给出最终总结：'
        : '以下是从图片和视频中提取出的信息，请基于这些内容给出最终总结：',
      mediaSections.join('\n\n')
    ].filter(Boolean).join('\n\n')

    return this.callSummaryTextAPI(finalPrompt)
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
    const parsed = parseLooseSearchIntentContent(content) || {}
    let query = cleanIntentText(parsed?.query) || currentQuestion
    let displayKeyword = cleanIntentText(parsed?.displayKeyword) || extractKeyword(query) || query
    let usedContext = normalizeIntentBoolean(parsed?.useContext)
    const fallback = buildSearchIntentFallback(currentQuestion, {
      replyText,
      replyNearbyTexts,
      historyTexts
    })
    const rawKeyword = extractKeyword(currentQuestion) || currentQuestion
    const fallbackUsed = Boolean(fallback) && (
      isAmbiguousSearchText(query)
      || isAmbiguousSearchText(displayKeyword)
      || (!usedContext && isAmbiguousSearchText(rawKeyword))
    )

    if (fallbackUsed && fallback) {
      query = fallback.query
      displayKeyword = fallback.displayKeyword || extractKeyword(query) || query
      usedContext = true
    }

    debugLog('search.intent', '搜索意图解析完成', {
      query: truncateDebugText(query, 160),
      displayKeyword: truncateDebugText(displayKeyword, 80),
      usedContext,
      fallbackUsed,
      fallbackSource: fallbackUsed ? fallback?.fallbackSource : '',
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

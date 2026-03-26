import fs from 'node:fs'
import path from 'node:path'
import { getByPath, cloneDeep, isPlainObject } from '../utils/common.js'
import { pluginName, pluginRoot } from './constant.js'

function normalizeConfig(defaults, overrides) {
  if (Array.isArray(defaults)) {
    return Array.isArray(overrides) ? cloneDeep(overrides) : cloneDeep(defaults)
  }

  if (isPlainObject(defaults)) {
    const source = isPlainObject(overrides) ? overrides : {}
    const normalized = {}

    for (const [key, value] of Object.entries(defaults)) {
      normalized[key] = normalizeConfig(value, source[key])
    }

    return normalized
  }

  return overrides === undefined ? cloneDeep(defaults) : cloneDeep(overrides)
}

const DEFAULT_CONFIG = {
  api: {
    primaryBaseUrl: 'https://your-api.example.com/v1',
    primaryApiKey: 'your-primary-api-key',
    search: {
      baseUrl: '',
      apiKey: '',
      model: 'perplexity-search',
      timeoutMs: 100000
    },
    summary: {
      baseUrl: '',
      apiKey: '',
      model: 'gemini-flash-latest',
      timeoutMs: 120000
    },
    video: {
      baseUrl: '',
      apiKey: '',
      model: 'qwen3-vl-plus',
      timeoutMs: 180000
    },
    audio: {
      baseUrl: '',
      apiKey: '',
      model: 'grok-4.1-fast',
      timeoutMs: 60000
    }
  },
  cache: {
    enabled: true,
    ttl: 10,
    maxSize: 100
  },
  debug: {
    enabled: false
  },
  prompt: {
    search: `你是一个信息整理助手。请将搜索结果整理成JSON格式，要求：
1. 只包含两个字段：详细信息、总结
2. 详细信息：对象格式，按类别分组整理，必须尽可能全面，保留原文至少70%以上的关键信息
3. 总结：一段简洁的总结性文字
4. 只输出JSON，不要使用markdown代码块`,
    summaryDefault: `你是一个智能助手。请对用户提供的内容进行全面分析和总结。

重要要求：
1. 直接输出纯文本，不要使用任何markdown格式
2. 使用简洁清晰的中文表达
3. 可以使用"•"符号作为列表项
4. 段落之间用空行分隔`,
    summaryImageAppend: `

注意：用户已经上传了{count}张图片，请直接分析这些图片内容。`,
    video: `你是一个视频分析助手。请仔细观看用户上传的视频，分析视频内容并进行总结。

重要要求：
1. 直接输出纯文本，不要使用任何markdown格式
2. 描述视频中的主要内容、场景、人物、动作等
3. 如果有对话或文字，请提取关键信息
4. 使用简洁清晰的中文表达`,
    groupChat: `请分析以下群聊记录，严格按以下格式输出（不要使用markdown格式）：

===话题总结===
（总结群内讨论的主要话题、热点内容和整体氛围，用纯文本描述）

===消息精选===
【时间】消息的原始时间
【发送者】发送者昵称
【内容】消息原文摘要
【吐槽】用幽默毒舌的语气吐槽为什么选中这条
---
（精选3-5条最有趣/最有价值/最离谱的消息，每条之间用---分隔）

发言统计（前10名）：{statsText}{extraContext}

聊天记录：
{messageTexts}`,
    groupMember: `请分析以下群聊中指定成员的聊天记录，严格按以下格式输出（不要使用markdown格式）：

===话题总结===
（总结他们讨论的主要话题、观点和互动情况，用纯文本描述）

===消息精选===
【时间】消息的原始时间
【发送者】发送者昵称
【内容】消息原文摘要
【吐槽】用幽默毒舌的语气吐槽为什么选中这条
---
（精选3-5条最有趣/最有价值/最离谱的消息，每条之间用---分隔）

发言统计：{statsText}{extraContext}

目标成员主页资料：
{memberProfiles}

聊天记录：
{messageTexts}`
  },
  fileRequest: {
    imageMaxPerRequest: 20,
    videoMaxPerRequest: 3,
    audioMaxPerRequest: 5,
    otherMaxPerRequest: 5,
    maxRequestLoops: 2
  },
  chatSummary: {
    defaultMessageCount: 800,
    atMemberMessageCount: 200,
    maxMessageCount: 500,
    docMaxChars: 2000,
    historyHoursLimit: 24
  },
  searchContext: {
    historyMessageCount: 5
  },
  send: {
    primaryMode: 'html',
    autoFallback: true,
    search: 'forward',
    contentSummary: '',
    groupChatSummary: '',
    memberSummary: '',
    searchScreenshotCount: -1,
    searchScreenshotMode: 'viewport',
    searchScreenshotTimeoutMs: 10000
  },
  scheduledSummary: {
    enabled: true,
    cron: '0 0 22 * * *',
    groups: [575872693],
    messageCount: 300
  }
}

class ConfigManager {
  constructor() {
    this.defaultDir = path.join(pluginRoot, 'config', 'default')
    this.configDir = path.join(pluginRoot, 'config', 'config')
    this.defaultFile = path.join(this.defaultDir, 'config.json')
    this.configFile = path.join(this.configDir, 'config.json')
    this.ensureFiles()
  }

  ensureFiles() {
    fs.mkdirSync(this.defaultDir, { recursive: true })
    fs.mkdirSync(this.configDir, { recursive: true })

    if (!fs.existsSync(this.defaultFile)) {
      this.writeJson(this.defaultFile, DEFAULT_CONFIG)
    }

    if (!fs.existsSync(this.configFile)) {
      this.writeJson(this.configFile, DEFAULT_CONFIG)
      return
    }

    const defaultConfig = normalizeConfig(DEFAULT_CONFIG, this.readJson(this.defaultFile, DEFAULT_CONFIG))
    const userConfig = this.readJson(this.configFile, {})
    const merged = normalizeConfig(defaultConfig, userConfig)

    if (JSON.stringify(defaultConfig) !== JSON.stringify(this.readJson(this.defaultFile, DEFAULT_CONFIG))) {
      this.writeJson(this.defaultFile, defaultConfig)
    }

    if (JSON.stringify(merged) !== JSON.stringify(userConfig)) {
      this.writeJson(this.configFile, merged)
    }
  }

  readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      logger?.error?.(`[${pluginName}] 读取配置失败：${filePath}`, error)
      return cloneDeep(fallback)
    }
  }

  writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  getAll() {
    this.ensureFiles()
    const defaultConfig = normalizeConfig(DEFAULT_CONFIG, this.readJson(this.defaultFile, DEFAULT_CONFIG))
    const userConfig = this.readJson(this.configFile, {})
    return normalizeConfig(defaultConfig, userConfig)
  }

  get(path, fallback = undefined) {
    return getByPath(this.getAll(), path, fallback)
  }

  setAll(config) {
    try {
      const merged = normalizeConfig(DEFAULT_CONFIG, config || {})
      this.writeJson(this.configFile, merged)
      return true
    } catch (error) {
      logger?.error?.(`[${pluginName}] 保存配置失败`, error)
      return false
    }
  }

  getDefault() {
    return cloneDeep(DEFAULT_CONFIG)
  }
}

export default new ConfigManager()

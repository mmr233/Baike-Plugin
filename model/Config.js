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

const DEFAULT_SCHEDULED_SUMMARY_TIME = {
  hour: 22,
  minute: 0,
  second: 0
}

const DEFAULT_GROUP_CHAT_PROMPT = `请分析以下群聊记录，严格按以下格式输出（不要使用markdown格式）：

额外要求：
1. 最终输出只能包含“===今日话题===”“===话题总结===”“===消息精选===”“===用户画像===”“===群聊质量锐评===”五部分
2. 不要在结尾额外输出“发言统计”“群聊图片内容”“文档”“成员资料”等标题
3. 图片、文档和成员资料只允许融合进今日话题、话题总结、消息精选、用户画像或群聊质量锐评的内容里，不要原样复述这些标题
4. 如果聊天记录里出现下面提供的机器人账号，请明确把它视为机器人本人发言，不要当作普通群友
5. 涉及机器人本人发言时，请使用第一人称“我”来评价或吐槽，不要用第三人称代称机器人
6. @消息请尽量还原为群聊记录里出现的群名片/昵称，不要输出@qq号

===今日话题===
【话题】10字以内的话题名
【参与者】主要参与者昵称，最多5人，用、分隔
【详情】讲清楚这个话题的来龙去脉、关键观点、结论或笑点，提到具体用户时用昵称
---
（提取2-4个最有意义的话题；没有明确话题时可少写）

===话题总结===
（用一小段总结群内讨论的主线、热点内容和整体氛围，语言自然，避免流水账）

===消息精选===
【时间】消息的原始时间
【发送者】发送者昵称
【内容】消息原文摘要
【吐槽】用幽默毒舌但不攻击个人的语气吐槽为什么选中这条
---
（精选3-5条最有趣/最有价值/最离谱的消息，每条之间用---分隔）

===用户画像===
【用户】用户昵称
【称号】一个有梗但不冒犯的称号
【关键词】#关键词1、#关键词2、#关键词3、#关键词4
【画像】结合发言内容概括此人在本轮聊天中的角色、关注点和互动风格
---
（精选2-4位最有代表性的群友，优先选择话题贡献者、精选消息发送者和高频发言者）

===群聊质量锐评===
【标题】今日群聊主题标题
【副标题】一句轻松的副标题
【维度】抽象维度名|比例|一句犀利、幽默或温情的点评
【维度】抽象维度名|比例|一句犀利、幽默或温情的点评
【维度】抽象维度名|比例|一句犀利、幽默或温情的点评
【总结】一句总结性的金句
（维度3-5个，维度名保持2-6字的抽象概括，不要写具体人名或具体事件；比例总和不超过100）

发言统计（前10名）：{statsText}{extraContext}

机器人账号资料：
{botProfile}

聊天记录：
{messageTexts}`

const DEFAULT_GROUP_MEMBER_PROMPT = `请分析以下群聊中指定成员的聊天记录，重点做“个人画像与公正评判”，严格按以下格式输出（不要使用markdown格式）：

额外要求：
1. 最终输出只能包含“===今日话题===”“===话题总结===”“===消息精选===”“===用户画像===”“===群聊质量锐评===”五部分
2. 这不是整群日报，不要大篇幅总结全群氛围、全群热点或其他群友表现；所有判断都必须围绕目标成员本人
3. 不要在结尾额外输出“发言统计”“群聊图片内容”“文档”“目标成员主页资料”等标题
4. 图片、文档和主页资料只允许作为证据融合进目标成员分析，不要原样复述这些标题
5. 如果聊天记录里出现下面提供的机器人账号，请明确把它视为机器人本人发言，不要当作普通群友
6. 涉及机器人本人发言时，请使用第一人称“我”来评价或吐槽，不要用第三人称代称机器人
7. @消息请尽量还原为群聊记录里出现的群名片/昵称，不要输出@qq号
8. 评价要公正克制：既指出亮点，也指出局限或风险；不要无根据贴标签，不做人身攻击

===今日话题===
【话题】10字以内的话题名
【参与者】目标成员和主要互动对象昵称，最多5人，用、分隔
【详情】围绕目标成员说明：他说了什么、回应了谁、表达了什么立场或情绪、对讨论有什么影响；少写群聊背景，多写个人证据
---
（提取1-3个与目标成员最相关的话题；没有明确话题时可少写）

===话题总结===
（用一段话总结目标成员本轮发言画像：主要关注点、观点倾向、信息价值、表达方式、互动姿态和情绪状态；不要写成整群总体总结）

===消息精选===
【时间】消息的原始时间
【发送者】目标成员昵称
【内容】目标成员消息原文摘要
【吐槽】说明这条消息体现了他的哪种行为模式、判断力、表达习惯或互动特点；语气可以幽默但必须基于证据
---
（精选3-5条目标成员本人最有代表性的消息；只有在理解上下文必须时才提及被回复/被@对象）

===用户画像===
【用户】目标成员昵称
【称号】一个有梗但不冒犯的称号
【关键词】#关键词1、#关键词2、#关键词3、#关键词4、#关键词5
【画像】结合发言证据概括该成员本轮聊天中的角色定位、兴趣焦点、表达风格、互动方式、稳定优点和可能短板
---
（原则上只输出目标成员；如果同时 @ 了多个成员，则每个目标成员各输出一条）

===群聊质量锐评===
【标题】目标成员表现标题
【副标题】一句轻松但准确的副标题
【维度】表达清晰度|比例|基于原话评价表达是否清楚、是否容易误解
【维度】互动贡献度|比例|评价他对讨论推进、回应他人、提供信息或制造情绪价值的贡献
【维度】观点稳定性|比例|评价他的观点是否一致、是否有依据、是否容易被情绪带走
【维度】社交分寸感|比例|评价玩笑、吐槽、反驳或沉默是否得体
【总结】一句总结性的个人评语
（维度3-5个，评价目标成员个人表现；比例总和不超过100；不要评价整群质量）

发言统计：{statsText}{extraContext}

目标成员主页资料：
{memberProfiles}

机器人账号资料：
{botProfile}

聊天记录：
{messageTexts}`

const DEFAULT_GROUP_TOPICS_PROMPT = `请分析以下群聊记录，提取最多 {maxTopics} 个最有意义的今日话题。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 话题名控制在 10 字以内，优先选择参与人数多、信息量高、有结论或有笑点的话题
3. contributors 使用群名片/昵称，不要输出 QQ 号
4. detail 要讲清前因后果、关键观点、结论或笑点，提到具体用户时使用昵称
5. 忽略单纯表情、复读、无意义水群；如果没有明确话题，返回 []

返回格式：
[
  {
    "topic": "话题名称",
    "contributors": ["昵称1", "昵称2"],
    "detail": "话题详细描述"
  }
]

发言统计：
{statsText}

补充信息：
{extraContext}

机器人账号资料：
{botProfile}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_HIGHLIGHTS_PROMPT = `请从以下群聊记录中挑选最多 {maxHighlights} 条最值得放进总结卡片的消息精选。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 优先选择有信息量、有转折、有笑点、有代表性或能体现群聊气质的原始发言
3. sender 使用群名片/昵称，不要输出 QQ 号；time 尽量使用原始时间
4. content 保留原文核心，不要过度改写；roast 用幽默、锐利但不攻击个人的语气说明入选原因
5. 不要把机器人系统提示、扣费信息、重复图片说明选为精选

返回格式：
[
  {
    "time": "19:30",
    "sender": "昵称",
    "content": "消息原文摘要",
    "roast": "入选理由或吐槽"
  }
]

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_USER_PORTRAITS_PROMPT = `请基于以下群聊记录和用户统计，为最多 {maxPortraits} 位最有代表性的群友生成用户画像。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 优先选择话题贡献者、精选消息发送者、高频发言者或互动风格明显的人
3. name 使用群名片/昵称；user_id 使用聊天记录中的用户ID，无法判断可留空
4. title 要有梗但不冒犯；keywords 输出 4-6 个具体关键词，避免空泛词
5. summary 要结合本轮发言说明角色、关注点、互动风格和代表性行为

返回格式：
[
  {
    "name": "昵称",
    "user_id": "123456",
    "title": "称号",
    "mbti": "可选MBTI",
    "keywords": ["关键词1", "关键词2", "关键词3", "关键词4"],
    "summary": "画像描述"
  }
]

用户统计：
{userStatsText}

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_QUALITY_PROMPT = `请分析以下群聊记录，输出一份“群聊质量锐评”。

要求：
1. 只输出合法 JSON 对象，不要使用 markdown 代码块，不要添加解释文字
2. dimensions 需要 3-5 个高层级抽象维度，name 控制在 2-6 字，不要写具体人名、项目名或细碎事件
3. percentage 是大致占比，总和不超过 100
4. comment 可以具体、幽默、犀利或温情，要能对应本轮群聊的真实内容
5. title 和 subtitle 要适合放在总结卡片中，summary 是一句总结性金句

返回格式：
{
  "title": "今日群聊主题",
  "subtitle": "一句副标题",
  "dimensions": [
    {
      "name": "抽象维度",
      "percentage": 35,
      "comment": "锐评内容"
    }
  ],
  "summary": "总结金句"
}

发言统计：
{statsText}

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_MEMBER_TOPICS_PROMPT = `请基于以下目标成员聊天记录，提取最多 {maxTopics} 个最能体现目标成员个人表现的话题切片。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 话题名控制在 10 字以内，必须围绕目标成员本人，不要写成整群热点
3. contributors 使用群名片/昵称，包含目标成员和必要互动对象，最多5人，不要输出 QQ 号
4. detail 要说明目标成员说了什么、回应了谁、表达了什么立场/情绪、对讨论有什么影响；少写群聊背景，多写个人证据
5. 没有明确话题时返回 []，不要为了凑数编造

返回格式：
[
  {
    "topic": "话题名称",
    "contributors": ["目标成员昵称", "互动对象昵称"],
    "detail": "围绕目标成员的证据化描述"
  }
]

发言统计：
{statsText}

补充信息：
{extraContext}

机器人账号资料：
{botProfile}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_MEMBER_HIGHLIGHTS_PROMPT = `请从以下目标成员聊天记录中挑选最多 {maxHighlights} 条最能代表目标成员个人表现的消息精选。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 只能精选目标成员本人发出的消息；其他人的内容只可作为理解上下文，不要喧宾夺主
3. sender 使用目标成员群名片/昵称，不要输出 QQ 号；time 尽量使用原始时间
4. content 保留原文核心，不要过度改写
5. roast 要说明这条消息体现了目标成员的行为模式、判断力、表达习惯或互动特点；评价公正克制，可以幽默但不要人身攻击

返回格式：
[
  {
    "time": "19:30",
    "sender": "目标成员昵称",
    "content": "目标成员消息原文摘要",
    "roast": "基于证据的个人表现点评"
  }
]

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_MEMBER_USER_PORTRAITS_PROMPT = `请基于以下目标成员聊天记录和用户统计，为最多 {maxPortraits} 位目标成员生成“个人画像与公正评判”。

要求：
1. 只输出合法 JSON 数组，不要使用 markdown 代码块，不要添加解释文字
2. 原则上只分析被总结的目标成员；如果记录里有多位目标成员，则每位目标成员各输出一条
3. name 使用群名片/昵称；user_id 使用聊天记录中的用户ID，无法判断可留空
4. title 要有梗但不冒犯；keywords 输出 5-7 个具体关键词，避免“活跃、友好”这类空泛词
5. summary 必须结合发言证据评价角色定位、兴趣焦点、表达风格、互动方式、稳定优点和可能短板；不要写整群氛围

返回格式：
[
  {
    "name": "目标成员昵称",
    "user_id": "123456",
    "title": "称号",
    "mbti": "可选MBTI",
    "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"],
    "summary": "证据化个人画像"
  }
]

用户统计：
{userStatsText}

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

const DEFAULT_GROUP_MEMBER_QUALITY_PROMPT = `请分析以下目标成员聊天记录，输出一份“个人表现锐评”，不要写成整群质量评价。

要求：
1. 只输出合法 JSON 对象，不要使用 markdown 代码块，不要添加解释文字
2. dimensions 需要 3-5 个个人表现维度，优先使用“表达清晰度、互动贡献度、观点稳定性、社交分寸感、信息价值”这类维度
3. percentage 是大致占比，总和不超过 100
4. comment 必须基于目标成员原话或行为，既指出亮点，也指出局限或风险；幽默可以，但不要人身攻击
5. title、subtitle、summary 都要围绕目标成员个人表现，不要评价整群质量

返回格式：
{
  "title": "目标成员表现标题",
  "subtitle": "一句轻松但准确的副标题",
  "dimensions": [
    {
      "name": "表达清晰度",
      "percentage": 25,
      "comment": "基于原话的点评"
    }
  ],
  "summary": "一句总结性的个人评语"
}

发言统计：
{statsText}

补充信息：
{extraContext}

聊天记录格式：[HH:MM] [用户ID] 昵称: 消息内容
聊天记录：
{messageTexts}`

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function isValidCron(cron) {
  if (!cron || typeof cron !== 'string') {
    return false
  }

  const parts = cron.trim().split(/\s+/)
  return parts.length >= 5 && parts.length <= 6
}

function parseCronToTime(cron, fallback = DEFAULT_SCHEDULED_SUMMARY_TIME) {
  if (!isValidCron(cron)) {
    return { ...fallback }
  }

  const parts = cron.trim().split(/\s+/)
  if (parts.length === 6) {
    return {
      hour: clampInteger(parts[2], 0, 23, fallback.hour),
      minute: clampInteger(parts[1], 0, 59, fallback.minute),
      second: clampInteger(parts[0], 0, 59, fallback.second)
    }
  }

  return {
    hour: clampInteger(parts[1], 0, 23, fallback.hour),
    minute: clampInteger(parts[0], 0, 59, fallback.minute),
    second: fallback.second
  }
}

function shouldMigrateLegacyGroupPrompt(prompt = '', type = 'groupChat') {
  const text = String(prompt || '')
  if (
    type === 'groupMember'
    && text.includes('请分析以下群聊中指定成员的聊天记录')
    && text.includes('目标成员主页资料')
    && text.includes('评价目标成员相关互动质量和发言风格')
    && !text.includes('个人画像与公正评判')
  ) {
    return true
  }

  if (!text.trim() || text.includes('===今日话题===') || text.includes('===用户画像===') || text.includes('===群聊质量锐评===')) {
    return false
  }

  const hasOldSections = text.includes('===话题总结===') && text.includes('===消息精选===')
  const hasOldLimiter = text.includes('最终输出只能包含') && text.includes('两部分')
  const hasPlaceholders = type === 'groupMember'
    ? text.includes('{memberProfiles}') && text.includes('{messageTexts}')
    : text.includes('{statsText}') && text.includes('{messageTexts}')

  return hasOldSections && hasOldLimiter && hasPlaceholders
}

function migrateLegacyConfig(config) {
  if (!isPlainObject(config)) {
    return {}
  }

  const nextConfig = cloneDeep(config)
  const sendConfig = isPlainObject(nextConfig.send)
    ? { ...nextConfig.send }
    : {}
  const scheduledSummary = isPlainObject(nextConfig.scheduledSummary)
    ? { ...nextConfig.scheduledSummary }
    : {}

  const missingCardNightWindow = sendConfig.cardNightStartHour === undefined && sendConfig.cardNightEndHour === undefined
  if (missingCardNightWindow && sendConfig.cardTheme === 'light') {
    sendConfig.cardTheme = 'auto'
  }
  if (sendConfig.cardTheme !== undefined || Object.keys(sendConfig).length > 0) {
    if (sendConfig.cardNightStartHour === undefined) {
      sendConfig.cardNightStartHour = 22
    }
    if (sendConfig.cardNightEndHour === undefined) {
      sendConfig.cardNightEndHour = 7
    }
    nextConfig.send = sendConfig
  }

  if (isValidCron(scheduledSummary.cron)) {
    const time = parseCronToTime(scheduledSummary.cron, DEFAULT_SCHEDULED_SUMMARY_TIME)
    if (scheduledSummary.hour === undefined) {
      scheduledSummary.hour = time.hour
    }
    if (scheduledSummary.minute === undefined) {
      scheduledSummary.minute = time.minute
    }
    if (scheduledSummary.second === undefined) {
      scheduledSummary.second = time.second
    }
  }

  if (
    scheduledSummary.hour !== undefined
    || scheduledSummary.minute !== undefined
    || scheduledSummary.second !== undefined
    || scheduledSummary.cron !== undefined
  ) {
    scheduledSummary.hour = clampInteger(
      scheduledSummary.hour,
      0,
      23,
      DEFAULT_SCHEDULED_SUMMARY_TIME.hour
    )
    scheduledSummary.minute = clampInteger(
      scheduledSummary.minute,
      0,
      59,
      DEFAULT_SCHEDULED_SUMMARY_TIME.minute
    )
    scheduledSummary.second = clampInteger(
      scheduledSummary.second,
      0,
      59,
      DEFAULT_SCHEDULED_SUMMARY_TIME.second
    )
    delete scheduledSummary.cron
    nextConfig.scheduledSummary = scheduledSummary
  }

  if (isPlainObject(nextConfig.prompt)) {
    const promptConfig = { ...nextConfig.prompt }
    if (shouldMigrateLegacyGroupPrompt(promptConfig.groupChat, 'groupChat')) {
      promptConfig.groupChat = DEFAULT_GROUP_CHAT_PROMPT
    }
    if (shouldMigrateLegacyGroupPrompt(promptConfig.groupMember, 'groupMember')) {
      promptConfig.groupMember = DEFAULT_GROUP_MEMBER_PROMPT
    }
    nextConfig.prompt = promptConfig
  }

  return nextConfig
}

const DEFAULT_CONFIG = {
  api: {
    primaryBaseUrl: 'https://your-api.example.com/v1',
    primaryApiKey: 'your-primary-api-key',
    presets: [
      {
        id: 'default',
        name: '默认接口',
        baseUrl: '',
        endpointType: 'openai-chat',
        keyGroups: [
          {
            id: 'default',
            name: '默认密钥',
            apiKey: ''
          }
        ]
      }
    ],
    search: {
      apiPresetId: '',
      apiKeyGroupId: '',
      baseUrl: '',
      apiKey: '',
      model: 'perplexity-search',
      endpointType: 'inherit',
      requestMode: 'response',
      fallbackModels: [],
      timeoutMs: 100000,
      connectTimeoutMs: 30000,
      retryCount: 1
    },
    summary: {
      apiPresetId: '',
      apiKeyGroupId: '',
      baseUrl: '',
      apiKey: '',
      model: 'gemini-flash-latest',
      endpointType: 'inherit',
      requestMode: 'response',
      fallbackModels: [],
      timeoutMs: 120000,
      connectTimeoutMs: 30000,
      retryCount: 1
    },
    image: {
      apiPresetId: '',
      apiKeyGroupId: '',
      baseUrl: '',
      apiKey: '',
      model: 'gemini-flash-latest',
      endpointType: 'inherit',
      requestMode: 'response',
      fallbackModels: [],
      timeoutMs: 120000,
      connectTimeoutMs: 30000,
      retryCount: 1
    },
    video: {
      apiPresetId: '',
      apiKeyGroupId: '',
      baseUrl: '',
      apiKey: '',
      model: 'qwen3-vl-plus',
      endpointType: 'inherit',
      requestMode: 'response',
      fallbackModels: [],
      timeoutMs: 180000,
      connectTimeoutMs: 30000,
      retryCount: 1
    },
    audio: {
      apiPresetId: '',
      apiKeyGroupId: '',
      baseUrl: '',
      apiKey: '',
      model: 'grok-4.1-fast',
      endpointType: 'inherit',
      requestMode: 'response',
      fallbackModels: [],
      timeoutMs: 60000,
      connectTimeoutMs: 30000,
      retryCount: 1
    }
  },
  cache: {
    enabled: true,
    ttl: 10,
    maxSize: 100
  },
  summaryBilling: {
    enabled: true,
    itemId: 'baike:summary_service',
    itemName: '百科总结服务',
    itemAliases: ['总结', '群聊总结', '群友总结', '内容总结', '媒体总结', '百科总结'],
    defaultCostFavor: 3,
    exemptMaster: true,
    chargeCached: false,
    chargeFailed: false,
    allowWhenUnavailable: false,
    respectIrisBaseEnable: true,
    limit: {
      enabled: true,
      maxUses: 20,
      periodHours: 24,
      scope: 'groupUser',
      countCached: false,
      countFailed: false,
      countMaster: false
    }
  },
  searchBilling: {
    enabled: true,
    itemId: 'baike:search_service',
    itemName: '百科搜索服务',
    itemAliases: ['搜索', '百科搜索', '查询', '百科查询'],
    defaultCostFavor: 2,
    exemptMaster: true,
    chargeCached: false,
    chargeFailed: false,
    allowWhenUnavailable: false,
    respectIrisBaseEnable: true,
    limit: {
      enabled: false,
      maxUses: 50,
      periodHours: 24,
      scope: 'groupUser',
      countCached: false,
      countFailed: false,
      countMaster: false
    }
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
    groupChat: DEFAULT_GROUP_CHAT_PROMPT,
    groupMember: DEFAULT_GROUP_MEMBER_PROMPT,
    groupTopics: DEFAULT_GROUP_TOPICS_PROMPT,
    groupHighlights: DEFAULT_GROUP_HIGHLIGHTS_PROMPT,
    groupUserPortraits: DEFAULT_GROUP_USER_PORTRAITS_PROMPT,
    groupQualityReview: DEFAULT_GROUP_QUALITY_PROMPT,
    groupMemberTopics: DEFAULT_GROUP_MEMBER_TOPICS_PROMPT,
    groupMemberHighlights: DEFAULT_GROUP_MEMBER_HIGHLIGHTS_PROMPT,
    groupMemberUserPortraits: DEFAULT_GROUP_MEMBER_USER_PORTRAITS_PROMPT,
    groupMemberQualityReview: DEFAULT_GROUP_MEMBER_QUALITY_PROMPT
  },
  fileRequest: {
    imageMaxPerRequest: 10,
    videoMaxPerRequest: 3,
    audioMaxPerRequest: 5,
    otherMaxPerRequest: 5,
    otherTextPreviewChars: 1500,
    documentPageMaxPerFile: 10,
    documentImageMaxPerFile: 4,
    maxRequestLoops: 2,
    longImageAutoSplit: {
      enabled: true,
      triggerHeight: 3200,
      chunkHeight: 2800,
      overlap: 96,
      maxSegments: 8
    },
    videoPreprocess: {
      enabled: true,
      compressTriggerSizeMb: 18,
      compressTargetSizeMb: 12,
      splitTriggerDurationSeconds: 90,
      segmentDurationSeconds: 45,
      maxSegments: 6,
      useImageModel: false,
      imageFramesPerSegment: 4,
      imageFrameStrategy: 'uniform',
      imageSceneThreshold: 0.25
    }
  },
  chatSummary: {
    defaultMessageCount: 800,
    atMemberMessageCount: 200,
    maxMessageCount: 500,
    docMaxChars: 2000,
    historyHoursLimit: 24,
    memberHistoryHoursLimit: null,
    historyFetch: {
      paginationEnabled: true,
      batchSize: 100,
      batchDelayMs: 50
    },
    filterBotMessages: true,
    skipBotMemberSummary: true,
    userPortraitMaxCount: 4,
    enhancedMode: {
      mode: 'economy',
      autoMessageThreshold: 220,
      maxConcurrent: 2,
      schemaRepairRetries: 1,
      topics: true,
      highlights: true,
      userPortraits: true,
      qualityReview: true,
      maxTopics: 4,
      maxHighlights: 5
    },
    inflightDedup: {
      enabled: true,
      waitMs: 120000
    }
  },
  searchContext: {
    enableConvenientCommand: false,
    historyMessageCount: 5,
    replyNearbyMessageCount: 6,
    filterBotMessages: true
  },
  send: {
    primaryMode: 'html',
    cardTheme: 'auto',
    cardNightStartHour: 22,
    cardNightEndHour: 7,
    autoFallback: true,
    search: 'forward',
    contentSummary: '',
    groupChatSummary: '',
    memberSummary: '',
    searchSourceDisplayLimit: 10,
    searchScreenshotCount: -1,
    searchScreenshotMode: 'viewport',
    searchScreenshotTimeoutMs: 10000
  },
  scheduledSummary: {
    enabled: true,
    hour: 22,
    minute: 0,
    second: 0,
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

    const defaultConfig = normalizeConfig(
      DEFAULT_CONFIG,
      migrateLegacyConfig(this.readJson(this.defaultFile, DEFAULT_CONFIG))
    )
    const userConfig = migrateLegacyConfig(this.readJson(this.configFile, {}))
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
    const defaultConfig = normalizeConfig(
      DEFAULT_CONFIG,
      migrateLegacyConfig(this.readJson(this.defaultFile, DEFAULT_CONFIG))
    )
    const userConfig = migrateLegacyConfig(this.readJson(this.configFile, {}))
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

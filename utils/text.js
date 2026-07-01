export function extractKeyword(message = '') {
  const patterns = [
    /是什么东西[啊呀哦噢]?$/,
    /是什么[啊呀哦噢]?$/,
    /是啥[啊呀哦噢]?$/,
    /什么东西[啊呀哦噢]?$/,
    /是谁[啊呀哦噢]?$/,
    /谁[啊呀哦噢]?$/
  ]

  for (const pattern of patterns) {
    if (pattern.test(message)) {
      return message.replace(pattern, '').trim()
    }
  }

  return message.trim()
}

export function beautifyText(text = '') {
  return String(text)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1')
    .replace(/```[\s\S]*?```/g, match => match.replace(/```\w*\n?/g, '').trim())
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    .replace(/^[\s]*(\d+\.)\s+/gm, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

export function formatDetailValue(value, indent = '') {
  if (Array.isArray(value)) {
    return value
      .map(item => `${indent}• ${typeof item === 'object' ? formatDetailValue(item, `${indent}  `) : item}`)
      .join('\n')
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => (
        item && typeof item === 'object'
          ? `${indent}${key}:\n${formatDetailValue(item, `${indent}  `)}`
          : `${indent}${key}: ${item}`
      ))
      .join('\n')
  }

  return String(value ?? '')
}

function parseBracketSections(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }

  const sections = []
  const pattern = /(?:^|\n)【([^】\n]+)】\s*\n([\s\S]*?)(?=(?:\n【[^】\n]+】\s*\n)|$)/g
  let match = pattern.exec(normalized)

  while (match) {
    sections.push({
      title: String(match[1] || '').trim(),
      content: String(match[2] || '').trim()
    })
    match = pattern.exec(normalized)
  }

  return sections.filter(item => item.title && item.content)
}

function findSummaryTailIndex(text = '') {
  const normalized = String(text || '').replace(/\r/g, '')
  const patterns = [
    /(?:^|\n)发言统计[（(]?[^\n：:]*[：:]/,
    /(?:^|\n)【群聊图片内容】/,
    /(?:^|\n)【文档:[^\n]+】/,
    /(?:^|\n)【目标成员主页资料】/,
    /(?:^|\n)【补充信息】/
  ]

  let minIndex = -1
  for (const pattern of patterns) {
    const match = pattern.exec(normalized)
    if (!match) {
      continue
    }

    const index = match.index + (match[0].startsWith('\n') ? 1 : 0)
    if (minIndex === -1 || index < minIndex) {
      minIndex = index
    }
  }

  return minIndex
}

function extractSummaryTailSections(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return {
      highlightText: '',
      statsSummary: '',
      extraSections: []
    }
  }

  const tailIndex = findSummaryTailIndex(normalized)
  if (tailIndex < 0) {
    return {
      highlightText: normalized,
      statsSummary: '',
      extraSections: []
    }
  }

  let tailText = normalized.slice(tailIndex).trim()
  let statsSummary = ''

  if (/^发言统计[（(]?[^\n：:]*[：:]/.test(tailText)) {
    const bracketIndex = tailText.search(/\n(?=【[^】\n]+】\s*\n)/)
    if (bracketIndex >= 0) {
      statsSummary = tailText.slice(0, bracketIndex).trim()
      tailText = tailText.slice(bracketIndex).trim()
    } else {
      statsSummary = tailText.trim()
      tailText = ''
    }
  }

  const extraSections = parseBracketSections(tailText)
  if (extraSections.length === 0 && tailText) {
    extraSections.push({
      title: '补充信息',
      content: tailText
    })
  }

  return {
    highlightText: normalized.slice(0, tailIndex).trim(),
    statsSummary,
    extraSections
  }
}

function extractMarkedSections(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }

  const matches = [...normalized.matchAll(/(?:^|\n)===\s*([^=\n]+?)\s*===\s*/g)]
  if (matches.length === 0) {
    return []
  }

  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length
    return {
      title: String(match[1] || '').trim(),
      content: normalized.slice(start, end).trim()
    }
  }).filter(item => item.title)
}

function getMarkedSection(sections = [], titles = []) {
  const titleSet = new Set(titles.map(item => String(item || '').trim()))
  const matched = sections.find(item => titleSet.has(item.title))
  return matched?.content || ''
}

function stripJsonFence(text = '') {
  return String(text || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function parseJsonLike(text = '') {
  const stripped = stripJsonFence(text)
  if (!stripped) {
    return null
  }

  try {
    return JSON.parse(stripped)
  } catch {}

  const firstArray = stripped.indexOf('[')
  const lastArray = stripped.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) {
    try {
      return JSON.parse(stripped.slice(firstArray, lastArray + 1))
    } catch {}
  }

  const firstObject = stripped.indexOf('{')
  const lastObject = stripped.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      return JSON.parse(stripped.slice(firstObject, lastObject + 1))
    } catch {}
  }

  return null
}

function splitStructuredBlocks(text = '', startLabels = []) {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }

  const separated = normalized
    .split(/\n\s*---+\s*\n/)
    .map(item => item.trim())
    .filter(Boolean)
  if (separated.length > 1 || startLabels.length === 0) {
    return separated
  }

  const startSet = new Set(startLabels)
  const blocks = []
  let current = []
  for (const line of normalized.split('\n')) {
    const marker = line.trim().match(/^【([^】\n]+)】/)
    if (marker && startSet.has(marker[1].trim()) && current.length > 0) {
      blocks.push(current.join('\n').trim())
      current = []
    }
    current.push(line)
  }

  if (current.length > 0) {
    blocks.push(current.join('\n').trim())
  }

  return blocks.filter(Boolean)
}

function parseBracketFields(text = '', multiLabels = []) {
  const fields = {}
  const multi = {}
  const multiSet = new Set(multiLabels)
  const pattern = /(?:^|\n)\s*【([^】\n]+)】\s*([\s\S]*?)(?=(?:\n\s*【[^】\n]+】)|$)/g
  let match = pattern.exec(String(text || '').replace(/\r/g, '').trim())

  while (match) {
    const key = String(match[1] || '').trim()
    const value = String(match[2] || '').trim()
    if (key && value) {
      if (multiSet.has(key)) {
        if (!multi[key]) {
          multi[key] = []
        }
        multi[key].push(value)
      } else {
        fields[key] = value
      }
    }
    match = pattern.exec(String(text || '').replace(/\r/g, '').trim())
  }

  return { fields, multi }
}

function pickField(fields = {}, names = []) {
  for (const name of names) {
    const value = fields[name]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

function splitNameList(value = '') {
  return String(value || '')
    .split(/[、,，/|；;]\s*|\s{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeTagList(value = '') {
  return splitNameList(value)
    .map(item => item.replace(/^#+/, '').trim())
    .filter(Boolean)
    .map(item => `#${item}`)
}

function normalizeUserLabel(value = '') {
  const label = String(value || '').trim()
  const idMatch = label.match(/(?:^|[（(]\s*)(\d{5,12})(?:\s*[）)]|$)/)
  const userId = idMatch?.[1] || ''
  const nickname = userId
    ? label.replace(/[（(]?\s*\d{5,12}\s*[）)]?/g, '').trim()
    : label

  return {
    userId,
    nickname: nickname || userId || label
  }
}

function parseTopicBlocks(text = '') {
  const json = parseJsonLike(text)
  if (Array.isArray(json)) {
    return json.map(item => ({
      topic: String(item?.topic || item?.name || '').trim(),
      contributors: Array.isArray(item?.contributors)
        ? item.contributors.map(value => String(value || '').trim()).filter(Boolean)
        : splitNameList(item?.contributors || item?.participants || ''),
      detail: String(item?.detail || item?.summary || item?.description || '').trim()
    })).filter(item => item.topic || item.detail)
  }

  return splitStructuredBlocks(text, ['话题', '主题'])
    .map(block => {
      const { fields } = parseBracketFields(block)
      return {
        topic: pickField(fields, ['话题', '主题', '名称']),
        contributors: splitNameList(pickField(fields, ['参与者', '主要参与者', '贡献者'])),
        detail: pickField(fields, ['详情', '详细描述', '内容', '总结'])
      }
    })
    .filter(item => item.topic || item.detail)
}

function parseHighlightBlocks(text = '') {
  return splitStructuredBlocks(text, ['时间'])
    .map(block => {
      const { fields } = parseBracketFields(block)
      return {
        time: pickField(fields, ['时间', '时刻']),
        sender: pickField(fields, ['发送者', '发言人', '用户', '成员']),
        content: pickField(fields, ['内容', '原文', '消息']),
        roast: pickField(fields, ['吐槽', '点评', '理由', '锐评'])
      }
    })
    .filter(item => item.content)
}

function parseUserPortraitBlocks(text = '') {
  const json = parseJsonLike(text)
  if (Array.isArray(json)) {
    return json.map(item => {
      const user = normalizeUserLabel(item?.name || item?.nickname || item?.user || item?.user_id || item?.userId || '')
      const userId = String(item?.user_id || item?.userId || user.userId || '').trim()
      const title = String(item?.title || item?.badge || '').trim()
      const mbti = String(item?.mbti || item?.MBTI || '').trim()
      const tags = [
        title,
        mbti,
        ...(Array.isArray(item?.keywords) ? item.keywords : splitNameList(item?.keywords || item?.tags || ''))
      ].map(value => String(value || '').replace(/^#+/, '').trim()).filter(Boolean)

      return {
        userId,
        nickname: String(item?.name || item?.nickname || user.nickname || userId || '').trim(),
        title,
        mbti,
        tags: tags.map(tag => `#${tag}`),
        summary: String(item?.summary || item?.reason || item?.portrait || '').trim()
      }
    }).filter(item => item.nickname || item.userId || item.summary)
  }

  return splitStructuredBlocks(text, ['用户', '成员', '昵称'])
    .map(block => {
      const { fields } = parseBracketFields(block)
      const user = normalizeUserLabel(pickField(fields, ['用户', '成员', '昵称', '名称']))
      const userId = pickField(fields, ['QQ', '用户ID', 'QQ号', 'ID']) || user.userId
      const title = pickField(fields, ['称号', '头衔', 'Title'])
      const mbti = pickField(fields, ['MBTI', '人格'])
      const keywordTags = normalizeTagList(pickField(fields, ['关键词', '标签', 'Tags']))
      const titleTags = [title, mbti]
        .map(item => String(item || '').replace(/^#+/, '').trim())
        .filter(Boolean)
        .map(item => `#${item}`)

      return {
        userId,
        nickname: user.nickname || userId,
        title,
        mbti,
        tags: [...titleTags, ...keywordTags],
        summary: pickField(fields, ['画像', '理由', '总结', '表现'])
      }
    })
    .filter(item => item.nickname || item.userId || item.summary)
}

function parseQualityDimensions(text = '') {
  const dimensionLines = []
  const pattern = /(?:^|\n)\s*【维度】\s*([^\n]+)/g
  let match = pattern.exec(String(text || '').replace(/\r/g, ''))
  while (match) {
    dimensionLines.push(String(match[1] || '').trim())
    match = pattern.exec(String(text || '').replace(/\r/g, ''))
  }

  return dimensionLines.map(line => {
    const parts = line.split('|').map(item => item.trim()).filter(Boolean)
    if (parts.length >= 3) {
      return {
        name: parts[0],
        percentage: Math.max(0, Math.min(Number.parseFloat(parts[1]) || 0, 100)),
        comment: parts.slice(2).join('|')
      }
    }

    const matched = line.match(/^(.+?)[：:]\s*(\d+(?:\.\d+)?)%?[，,]\s*(.+)$/)
    if (matched) {
      return {
        name: matched[1].trim(),
        percentage: Math.max(0, Math.min(Number.parseFloat(matched[2]) || 0, 100)),
        comment: matched[3].trim()
      }
    }

    return {
      name: line,
      percentage: 0,
      comment: ''
    }
  }).filter(item => item.name)
}

function parseQualityReview(text = '') {
  const json = parseJsonLike(text)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const dimensions = Array.isArray(json.dimensions)
      ? json.dimensions.map(item => ({
        name: String(item?.name || item?.title || '').trim(),
        percentage: Math.max(0, Math.min(Number.parseFloat(item?.percentage) || 0, 100)),
        comment: String(item?.comment || item?.summary || '').trim()
      })).filter(item => item.name)
      : []

    const review = {
      title: String(json.title || '').trim(),
      subtitle: String(json.subtitle || '').trim(),
      dimensions,
      summary: String(json.summary || '').trim()
    }

    return review.title || review.subtitle || review.dimensions.length > 0 || review.summary
      ? review
      : null
  }

  const { fields } = parseBracketFields(text, ['维度'])
  const review = {
    title: pickField(fields, ['标题', '主题']),
    subtitle: pickField(fields, ['副标题', '小标题']),
    dimensions: parseQualityDimensions(text),
    summary: pickField(fields, ['总结', '金句', '评价'])
  }

  return review.title || review.subtitle || review.dimensions.length > 0 || review.summary
    ? review
    : null
}

export function parseSummaryContent(text = '') {
  const result = {
    topicSummary: '',
    topics: [],
    highlights: [],
    userPortraits: [],
    qualityReview: null,
    statsSummary: '',
    extraSections: []
  }

  if (!text) {
    return result
  }

  const normalized = String(text || '').replace(/\r/g, '').trim()
  const markedSections = extractMarkedSections(normalized)
  const hasMarkedSections = markedSections.length > 0

  const topicBlocksText = getMarkedSection(markedSections, ['今日话题', '核心话题', '话题列表'])
  result.topics = parseTopicBlocks(topicBlocksText)
  result.topicSummary = getMarkedSection(markedSections, ['话题总结', '整体总结'])

  if (!result.topicSummary) {
    const topicMatch = normalized.match(/===话题总结===([\s\S]*?)(?=\n===|$)/)
    result.topicSummary = topicMatch
      ? topicMatch[1].trim()
      : hasMarkedSections
        ? ''
        : normalized.split('===消息精选===')[0].trim()
  }

  const highlightText = getMarkedSection(markedSections, ['消息精选', '金句精选'])
  const highlightMatch = highlightText
    ? ['', highlightText]
    : normalized.match(/===消息精选===([\s\S]*)$/)
  if (highlightMatch) {
    const tailParsed = extractSummaryTailSections(highlightMatch[1])
    result.statsSummary = tailParsed.statsSummary
    result.extraSections = tailParsed.extraSections
    result.highlights = parseHighlightBlocks(tailParsed.highlightText)
  }

  result.userPortraits = parseUserPortraitBlocks(getMarkedSection(markedSections, ['用户画像', '群友画像', '成员画像']))
  result.qualityReview = parseQualityReview(getMarkedSection(markedSections, ['群聊质量锐评', '聊天质量锐评', '群聊锐评', '质量锐评']))

  const knownTitles = new Set([
    '今日话题',
    '核心话题',
    '话题列表',
    '话题总结',
    '整体总结',
    '消息精选',
    '金句精选',
    '用户画像',
    '群友画像',
    '成员画像',
    '群聊质量锐评',
    '聊天质量锐评',
    '群聊锐评',
    '质量锐评'
  ])
  const unknownMarkedSections = markedSections
    .filter(item => !knownTitles.has(item.title) && item.content)
    .map(item => ({
      title: item.title,
      content: item.content
    }))
  result.extraSections.push(...unknownMarkedSections)

  if (
    !result.topicSummary
    && result.topics.length === 0
    && result.highlights.length === 0
    && result.userPortraits.length === 0
    && !result.qualityReview
    && result.extraSections.length === 0
  ) {
    result.topicSummary = normalized
  }

  return result
}

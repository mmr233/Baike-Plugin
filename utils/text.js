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

export function parseSummaryContent(text = '') {
  const result = {
    topicSummary: '',
    highlights: []
  }

  if (!text) {
    return result
  }

  const topicMatch = text.match(/===话题总结===([\s\S]*?)(?====消息精选===|$)/)
  result.topicSummary = topicMatch
    ? topicMatch[1].trim()
    : text.split('===消息精选===')[0].trim()

  const highlightMatch = text.match(/===消息精选===([\s\S]*)$/)
  if (highlightMatch) {
    const sections = highlightMatch[1]
      .split(/---+/)
      .map(item => item.trim())
      .filter(Boolean)

    for (const section of sections) {
      const timeMatch = section.match(/【时间】\s*(.+)/)
      const senderMatch = section.match(/【发送者】\s*(.+)/)
      const contentMatch = section.match(/【内容】\s*([\s\S]*?)(?=【吐槽】|$)/)
      const roastMatch = section.match(/【吐槽】\s*([\s\S]+)$/)

      if (!contentMatch) {
        continue
      }

      result.highlights.push({
        time: timeMatch?.[1]?.trim() || '',
        sender: senderMatch?.[1]?.trim() || '',
        content: contentMatch?.[1]?.trim() || '',
        roast: roastMatch?.[1]?.trim() || ''
      })
    }
  }

  if (!result.topicSummary && result.highlights.length === 0) {
    result.topicSummary = text.trim()
  }

  return result
}

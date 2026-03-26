import { escapeHtml } from './text.js'

function getJournalCSS() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      background: #f5ebe0;
      min-height: 100vh;
      padding: 16px;
    }
    .journal {
      max-width: 620px;
      margin: 0 auto;
      background: #fffdf7;
      border-radius: 18px;
      border: 2px solid #d4a574;
      box-shadow: 3px 3px 0 #e6c9a8, 6px 6px 15px rgba(139,90,43,0.15);
      overflow: hidden;
      position: relative;
    }
    .journal::before {
      content: '';
      position: absolute;
      left: 36px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: repeating-linear-gradient(to bottom, #e8c9a0 0, #e8c9a0 4px, transparent 4px, transparent 8px);
      z-index: 1;
    }
    .journal-header {
      background: linear-gradient(135deg, #c44569 0%, #e8856e 50%, #f0a370 100%);
      padding: 18px 24px 18px 50px;
      position: relative;
      overflow: hidden;
    }
    .journal-header::after {
      content: '';
      position: absolute;
      right: -20px;
      top: -20px;
      width: 80px;
      height: 80px;
      background: rgba(255,255,255,0.1);
      border-radius: 50%;
    }
    .journal-header h1 {
      color: #fff;
      font-size: 18px;
      font-weight: bold;
      text-shadow: 1px 1px 3px rgba(0,0,0,0.2);
    }
    .journal-header .date-tag {
      color: rgba(255,255,255,0.85);
      font-size: 11px;
      margin-top: 4px;
    }
    .journal-body { padding: 20px 20px 20px 50px; }
    .section {
      background: rgba(255,248,235,0.7);
      border: 1px dashed #d4a574;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
      position: relative;
    }
    .section-title {
      color: #c44569;
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .text-content {
      color: #5a4a3a;
      font-size: 13px;
      line-height: 1.85;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .stamp {
      position: absolute;
      right: 12px;
      top: 10px;
      width: 40px;
      height: 40px;
      border: 2px solid #c44569;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      opacity: 0.3;
      transform: rotate(15deg);
    }
    .metric-row {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric-card {
      flex: 1;
      border-radius: 12px;
      padding: 12px;
      border: 1px solid #ead5c1;
      background: linear-gradient(135deg, rgba(255,240,243,0.95), rgba(255,228,233,0.95));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
      text-align: center;
    }
    .metric-card.blue {
      background: linear-gradient(135deg, rgba(240,247,255,0.95), rgba(228,240,255,0.95));
      border-color: #c6d8f0;
    }
    .metric-icon {
      font-size: 19px;
      margin-bottom: 4px;
    }
    .metric-label {
      font-size: 11px;
      color: #9b7d61;
      margin-bottom: 4px;
    }
    .metric-value {
      font-size: 18px;
      font-weight: bold;
      color: #c44569;
    }
    .metric-card.blue .metric-value {
      color: #5b9bd5;
    }
    .hero-note {
      margin-bottom: 14px;
      padding: 14px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(234,245,255,0.96), rgba(245,250,255,0.96));
      border: 1px solid #cfe1f3;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
    }
    .hero-kicker {
      color: #5b9bd5;
      font-size: 11px;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .hero-text {
      color: #35506b;
      font-size: 13px;
      line-height: 1.8;
      word-break: break-word;
    }
    .card-stack {
      display: block;
    }
    .info-card {
      background: rgba(255,255,255,0.65);
      border: 1px solid #ead5c1;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
    }
    .info-card:last-child {
      margin-bottom: 0;
    }
    .info-card-title {
      color: #c44569;
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .chart-panel {
      margin-bottom: 14px;
      padding: 14px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(255,250,243,0.96), rgba(255,245,232,0.96));
      border: 1px solid #ead5c1;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.68);
    }
    .chart-title {
      color: #c44569;
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .chart-row {
      margin-bottom: 10px;
    }
    .chart-row:last-child {
      margin-bottom: 0;
    }
    .chart-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      font-size: 12px;
      color: #6e5a48;
    }
    .chart-label {
      font-weight: bold;
      color: #5a4a3a;
      word-break: break-word;
    }
    .chart-value {
      color: #c44569;
      font-weight: bold;
      white-space: nowrap;
    }
    .chart-track {
      height: 10px;
      border-radius: 999px;
      background: rgba(212,165,116,0.18);
      overflow: hidden;
      position: relative;
    }
    .chart-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #e8856e 0%, #f0a370 100%);
    }
    .chart-fill.blue {
      background: linear-gradient(90deg, #5b9bd5 0%, #88c0ef 100%);
    }
    .vertical-chart-panel {
      margin-bottom: 14px;
      padding: 14px 14px 10px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(255,250,243,0.96), rgba(255,245,232,0.96));
      border: 1px solid #ead5c1;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.68);
    }
    .vertical-chart-title {
      color: #5b9bd5;
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 12px;
    }
    .vertical-chart-grid {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      min-height: 170px;
    }
    .vertical-chart-item {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }
    .vertical-chart-value {
      color: #5b9bd5;
      font-size: 11px;
      font-weight: bold;
      line-height: 1;
    }
    .vertical-chart-track {
      width: 100%;
      max-width: 26px;
      height: 110px;
      border-radius: 999px;
      background: rgba(91,155,213,0.16);
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
    }
    .vertical-chart-fill {
      width: 100%;
      border-radius: 999px;
      background: linear-gradient(180deg, #88c0ef 0%, #5b9bd5 100%);
      min-height: 8px;
    }
    .vertical-chart-label {
      color: #6e5a48;
      font-size: 11px;
      line-height: 1.35;
      text-align: center;
      word-break: break-word;
    }
    .rich-paragraph {
      color: #5a4a3a;
      font-size: 13px;
      line-height: 1.85;
      word-break: break-word;
      white-space: pre-wrap;
      margin-bottom: 10px;
    }
    .rich-paragraph:last-child {
      margin-bottom: 0;
    }
    .rich-list {
      margin: 0 0 10px 18px;
      padding: 0;
      color: #5a4a3a;
    }
    .rich-list:last-child {
      margin-bottom: 0;
    }
    .rich-list li {
      font-size: 13px;
      line-height: 1.8;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .rich-list li:last-child {
      margin-bottom: 0;
    }
    .source-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .source-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      background: rgba(255,255,255,0.6);
      border: 1px solid #ead5c1;
      border-radius: 10px;
    }
    .source-index {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #5b9bd5;
      color: #fff;
      font-size: 12px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .source-main {
      flex: 1;
      min-width: 0;
    }
    .source-host {
      color: #5b9bd5;
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .source-url {
      color: #6e5a48;
      font-size: 11px;
      line-height: 1.65;
      word-break: break-all;
    }
    .empty-state {
      color: #a18467;
      font-size: 12px;
      line-height: 1.7;
    }
    .journal-footer {
      background: linear-gradient(90deg, #f5ebe0, #fffdf7, #f5ebe0);
      padding: 10px 24px;
      text-align: center;
      border-top: 1px dashed #d4a574;
    }
    .journal-footer span { color: #b8977a; font-size: 11px; font-style: italic; }
    .pin {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #c44569;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(196,69,105,0.4);
      margin-right: 6px;
      vertical-align: middle;
    }
  `
}

function normalizeTextBlocks(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
}

function isListLine(line = '') {
  return /^([•\-*]|\d+\.)\s+/.test(String(line || '').trim())
}

function stripListMarker(line = '') {
  return String(line || '').trim().replace(/^([•\-*]|\d+\.)\s+/, '')
}

function getPreviewText(text = '', maxLength = 150) {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/【[^】\n]+】\n/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!normalized) {
    return ''
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized
}

function renderListHtml(items = []) {
  if (items.length === 0) {
    return ''
  }

  return `
    <ul class="rich-list">
      ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `
}

function renderTextBlock(block = '') {
  const lines = String(block || '')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return ''
  }

  const segments = []
  let paragraphLines = []
  let listItems = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return
    }
    segments.push(`<div class="rich-paragraph">${escapeHtml(paragraphLines.join('\n'))}</div>`)
    paragraphLines = []
  }

  const flushList = () => {
    if (listItems.length === 0) {
      return
    }
    segments.push(renderListHtml(listItems))
    listItems = []
  }

  for (const line of lines) {
    if (isListLine(line)) {
      flushParagraph()
      listItems.push(stripListMarker(line))
    } else {
      flushList()
      paragraphLines.push(line)
    }
  }

  flushParagraph()
  flushList()

  return segments.join('')
}

function renderRichTextHtml(text = '') {
  const blocks = normalizeTextBlocks(text)
  if (blocks.length === 0) {
    return '<div class="empty-state">暂无内容</div>'
  }

  return blocks.map(renderTextBlock).join('')
}

function parseBracketSections(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }

  const sections = []
  const pattern = /(?:^|\n)【([^】\n]+)】\n([\s\S]*?)(?=(?:\n【[^】\n]+】\n)|$)/g
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

function getHostLabel(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return '参考链接'
  }
}

function renderMetricCard(icon, label, value, colorClass = '') {
  return `
    <div class="metric-card ${colorClass}">
      <div class="metric-icon">${icon}</div>
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(String(value))}</div>
    </div>
  `
}

function renderBarChart(items = [], title = '统计') {
  const normalized = items
    .map(item => ({
      label: String(item?.label || '').trim(),
      value: Math.max(0, Number(item?.value) || 0),
      color: item?.color === 'blue' ? 'blue' : ''
    }))
    .filter(item => item.label)

  if (normalized.length === 0) {
    return ''
  }

  const maxValue = Math.max(...normalized.map(item => item.value), 1)

  return `
    <div class="chart-panel">
      <div class="chart-title">${escapeHtml(title)}</div>
      ${normalized.map(item => `
        <div class="chart-row">
          <div class="chart-meta">
            <span class="chart-label">${escapeHtml(item.label)}</span>
            <span class="chart-value">${escapeHtml(String(item.value))}</span>
          </div>
          <div class="chart-track">
            <div class="chart-fill ${item.color}" style="width:${Math.max(8, Math.round((item.value / maxValue) * 100))}%;"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `
}

function renderVerticalBarChart(items = [], title = '时间分布') {
  const normalized = items
    .map(item => ({
      label: String(item?.label || '').trim(),
      value: Math.max(0, Number(item?.value) || 0)
    }))
    .filter(item => item.label)

  if (normalized.length === 0) {
    return ''
  }

  const maxValue = Math.max(...normalized.map(item => item.value), 1)

  return `
    <div class="vertical-chart-panel">
      <div class="vertical-chart-title">${escapeHtml(title)}</div>
      <div class="vertical-chart-grid">
        ${normalized.map(item => `
          <div class="vertical-chart-item">
            <div class="vertical-chart-value">${escapeHtml(String(item.value))}</div>
            <div class="vertical-chart-track">
              <div class="vertical-chart-fill" style="height:${Math.max(8, Math.round((item.value / maxValue) * 100))}%;"></div>
            </div>
            <div class="vertical-chart-label">${escapeHtml(item.label)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

export function generateHutaoHTML(title, content, stats = null) {
  const statsHtml = stats
    ? `
      <div class="metric-row">
        ${renderMetricCard('📨', '消息数量', stats.messageCount || 0)}
        ${renderMetricCard('👥', '活跃成员', stats.memberCount || 0, 'blue')}
      </div>
    `
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal">
      <div class="journal-header">
        <h1>🔥 ${escapeHtml(title)}</h1>
        <div class="date-tag">📅 ${new Date().toLocaleString('zh-CN')} · 胡桃的手帐</div>
      </div>
      <div class="journal-body">
        ${statsHtml}
        <div class="section">
          <div class="stamp">✨</div>
          <div class="section-title">内容分析</div>
          ${renderRichTextHtml(content)}
        </div>
      </div>
      <div class="journal-footer"><span>✿ 胡桃手帐 · 百科查询插件出品 ✿</span></div>
    </div></body></html>`
}

export function generateSearchHTML(keyword, content, citations = []) {
  const sections = parseBracketSections(content)
  const paragraphCount = sections.length > 0
    ? sections.reduce((sum, item) => sum + normalizeTextBlocks(item.content).length, 0)
    : normalizeTextBlocks(content).length
  const contentCount = sections.length > 0
    ? sections.length
    : Math.max(normalizeTextBlocks(content).length, content ? 1 : 0)
  const contentLabel = sections.length > 0 ? '信息模块' : '内容段落'
  const previewText = getPreviewText(content)
  const chartHtml = renderBarChart([
    { label: '信息模块', value: sections.length > 0 ? sections.length : 1 },
    { label: '内容段落', value: Math.max(1, paragraphCount), color: 'blue' },
    { label: '参考来源', value: citations.length }
  ], '信息数量统计')

  const contentHtml = content
    ? `
      <div class="section">
        <div class="section-title">检索内容</div>
        ${sections.length > 0
          ? `
            <div class="card-stack">
              ${sections.map(item => `
                <div class="info-card">
                  <div class="info-card-title">${escapeHtml(item.title)}</div>
                  ${renderRichTextHtml(item.content)}
                </div>
              `).join('')}
            </div>
          `
          : renderRichTextHtml(content)}
      </div>
    `
    : ''

  const citationsHtml = citations.length > 0
    ? `
      <div class="section" style="background:rgba(245,235,224,0.5);">
        <div class="section-title">参考来源</div>
        <div class="source-list">
          ${citations.map((item, index) => `
            <div class="source-item">
              <div class="source-index">${index + 1}</div>
              <div class="source-main">
                <div class="source-host">${escapeHtml(getHostLabel(item))}</div>
                <div class="source-url">${escapeHtml(item)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal">
      <div class="journal-header" style="background:linear-gradient(135deg,#5b9bd5 0%,#7cb8e8 50%,#a0d2f0 100%);">
        <h1>🔍 ${escapeHtml(keyword)}</h1>
        <div class="date-tag">📅 ${new Date().toLocaleString('zh-CN')} · 胡桃的手帐</div>
      </div>
      <div class="journal-body">
        <div class="metric-row">
          ${renderMetricCard('🧩', contentLabel, contentCount)}
          ${renderMetricCard('🔗', '参考来源', citations.length, 'blue')}
        </div>
        ${chartHtml}
        ${previewText ? `
          <div class="hero-note">
            <div class="hero-kicker">RESULT SNAPSHOT</div>
            <div class="hero-text">${escapeHtml(previewText)}</div>
          </div>
        ` : ''}
        ${contentHtml}
        ${citationsHtml}
      </div>
      <div class="journal-footer"><span>✿ 胡桃手帐 · 百科查询插件出品 ✿</span></div>
    </div></body></html>`
}

export function generateGroupSummaryHTML(title, parsedContent, data = {}) {
  const {
    messageCount = 0,
    memberCount = 0,
    sortedMembers = [],
    hourlyActivity = {},
    isMemberMode = false
  } = data
  const { topicSummary = '', highlights = [] } = parsedContent || {}
  const rankChartHtml = !isMemberMode && sortedMembers.length > 0
    ? renderBarChart(
      sortedMembers.slice(0, 10).map(([name, count], index) => ({
        label: index === 0 ? `${name} · TOP1` : name,
        value: count,
        color: index === 0 ? '' : 'blue'
      })),
      '发言数量统计'
    )
    : ''
  const activityChartHtml = Object.keys(hourlyActivity).length > 0
    ? renderVerticalBarChart(
      Object.entries(hourlyActivity)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([hour, count]) => ({
          label: `${hour} 点`,
          value: count
        })),
      '时间活跃分布'
    )
    : ''

  const statsHtml = isMemberMode
    ? `
      <div class="metric-row">
        ${renderMetricCard('📨', '相关消息', messageCount)}
      </div>
    `
    : `
      <div class="metric-row">
        ${renderMetricCard('📨', '消息数量', messageCount)}
        ${renderMetricCard('👥', '活跃成员', memberCount, 'blue')}
      </div>
    `

  const topicHtml = topicSummary
    ? `
      <div class="section">
        <div class="stamp">📝</div>
        <div class="section-title">话题总结</div>
        ${renderRichTextHtml(topicSummary)}
      </div>
    `
    : ''

  const highlightsHtml = highlights.length > 0
    ? `
      <div class="section">
        <div class="section-title">${isMemberMode ? '成员消息精选' : '群消息精选'}</div>
        ${highlights.map(item => `
          <div style="background:rgba(255,255,255,0.5);border:1px solid #ead5c1;border-radius:10px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#b8977a;margin-bottom:6px;">
              <span>${escapeHtml(item.sender || '匿名')}</span>
              <span>${escapeHtml(item.time || '')}</span>
            </div>
            ${renderRichTextHtml(item.content || '')}
            ${item.roast ? `<div style="margin-top:8px;">${renderRichTextHtml(item.roast)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal">
      <div class="journal-header">
        <h1>🔥 ${escapeHtml(title)}</h1>
        <div class="date-tag">📅 ${new Date().toLocaleString('zh-CN')} · 胡桃的手帐</div>
      </div>
      <div class="journal-body">
        ${statsHtml}
        ${rankChartHtml}
        ${activityChartHtml}
        ${topicHtml}
        ${highlightsHtml}
      </div>
      <div class="journal-footer"><span>✿ 胡桃手帐 · 百科查询插件出品 ✿</span></div>
    </div></body></html>`
}

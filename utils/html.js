import { escapeHtml, formatDetailValue } from './text.js'

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

export function generateHutaoHTML(title, content, stats = null) {
  const statsHtml = stats
    ? `
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <div style="flex:1;background:linear-gradient(135deg,#fff0f3,#ffe4e9);border-radius:12px;padding:12px;text-align:center;border:1px solid #f5c6d0;">
          <div style="font-size:20px;">📨</div>
          <div style="font-size:11px;color:#b8977a;">消息数量</div>
          <div style="font-size:18px;font-weight:bold;color:#c44569;">${stats.messageCount || 0}</div>
        </div>
        <div style="flex:1;background:linear-gradient(135deg,#f0f7ff,#e4f0ff);border-radius:12px;padding:12px;text-align:center;border:1px solid #c6d8f0;">
          <div style="font-size:20px;">👥</div>
          <div style="font-size:11px;color:#b8977a;">活跃成员</div>
          <div style="font-size:18px;font-weight:bold;color:#5b9bd5;">${stats.memberCount || 0}</div>
        </div>
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
          <div class="text-content">${escapeHtml(content)}</div>
        </div>
      </div>
      <div class="journal-footer"><span>✿ 胡桃手帐 · 百科查询插件出品 ✿</span></div>
    </div></body></html>`
}

export function generateSearchHTML(keyword, detailInfo, summary, citations = []) {
  let detailHtml = ''

  if (detailInfo && typeof detailInfo === 'object') {
    for (const [key, value] of Object.entries(detailInfo)) {
      detailHtml += `
        <div style="margin-bottom:10px;">
          <div style="color:#c44569;font-weight:bold;font-size:13px;margin-bottom:4px;"><span class="pin"></span>【${escapeHtml(key)}】</div>
          <div class="text-content" style="padding-left:14px;">${escapeHtml(formatDetailValue(value))}</div>
        </div>
      `
    }
  } else if (detailInfo) {
    detailHtml = `<div class="text-content">${escapeHtml(String(detailInfo))}</div>`
  }

  const citationsHtml = citations.length > 0
    ? `
      <div class="section" style="background:rgba(245,235,224,0.5);">
        <div class="section-title">参考来源</div>
        ${citations.map((item, index) => `<div style="color:#8b5e3c;font-size:11px;margin:4px 0;word-break:break-all;">${index + 1}. ${escapeHtml(item)}</div>`).join('')}
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
        ${detailHtml ? `<div class="section"><div class="stamp">📖</div><div class="section-title">详细信息</div>${detailHtml}</div>` : ''}
        ${summary ? `<div class="section" style="background:rgba(196,69,105,0.05);border-color:#f5c6d0;"><div class="section-title">总结</div><div class="text-content">${escapeHtml(summary)}</div></div>` : ''}
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

  const statsHtml = isMemberMode
    ? `
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <div style="flex:1;background:linear-gradient(135deg,#fff0f3,#ffe4e9);border-radius:12px;padding:12px;text-align:center;border:1px solid #f5c6d0;">
          <div style="font-size:20px;">📨</div>
          <div style="font-size:11px;color:#b8977a;">相关消息</div>
          <div style="font-size:18px;font-weight:bold;color:#c44569;">${messageCount}</div>
        </div>
      </div>
    `
    : `
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <div style="flex:1;background:linear-gradient(135deg,#fff0f3,#ffe4e9);border-radius:12px;padding:12px;text-align:center;border:1px solid #f5c6d0;">
          <div style="font-size:20px;">📨</div>
          <div style="font-size:11px;color:#b8977a;">消息数量</div>
          <div style="font-size:18px;font-weight:bold;color:#c44569;">${messageCount}</div>
        </div>
        <div style="flex:1;background:linear-gradient(135deg,#f0f7ff,#e4f0ff);border-radius:12px;padding:12px;text-align:center;border:1px solid #c6d8f0;">
          <div style="font-size:20px;">👥</div>
          <div style="font-size:11px;color:#b8977a;">活跃成员</div>
          <div style="font-size:18px;font-weight:bold;color:#5b9bd5;">${memberCount}</div>
        </div>
      </div>
    `

  const rankHtml = !isMemberMode && sortedMembers.length > 0
    ? `
      <div class="section">
        <div class="section-title">发言排行 Top${Math.min(sortedMembers.length, 10)}</div>
        ${sortedMembers.slice(0, 10).map(([name, count]) => `
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#5a4a3a;line-height:1.9;">
            <span>${escapeHtml(name)}</span>
            <strong>${count}</strong>
          </div>
        `).join('')}
      </div>
    `
    : ''

  const activityHtml = Object.keys(hourlyActivity).length > 0
    ? `
      <div class="section">
        <div class="section-title">时间活跃度</div>
        <div class="text-content">${Object.entries(hourlyActivity)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([hour, count]) => `${hour} 点：${count} 条`)
          .join('\n')}</div>
      </div>
    `
    : ''

  const topicHtml = topicSummary
    ? `
      <div class="section">
        <div class="stamp">📝</div>
        <div class="section-title">话题总结</div>
        <div class="text-content">${escapeHtml(topicSummary)}</div>
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
            <div style="font-size:12px;color:#5a4a3a;line-height:1.7;">${escapeHtml(item.content || '')}</div>
            ${item.roast ? `<div style="margin-top:6px;font-size:11px;color:#e8856e;line-height:1.6;">${escapeHtml(item.roast)}</div>` : ''}
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
        ${rankHtml}
        ${activityHtml}
        ${topicHtml}
        ${highlightsHtml}
      </div>
      <div class="journal-footer"><span>✿ 胡桃手帐 · 百科查询插件出品 ✿</span></div>
    </div></body></html>`
}

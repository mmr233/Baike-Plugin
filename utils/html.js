import fs from 'node:fs'
import path from 'node:path'
import { pluginName, pluginRoot, packageInfo } from '../model/constant.js'
import { escapeHtml } from './text.js'

let footerTextCache = null

function formatHostName(name = '') {
  const normalized = String(name || '').trim().toLowerCase()
  if (normalized === 'trss-yunzai') {
    return 'TRSS-Yunzai'
  }
  if (normalized === 'miao-yunzai') {
    return 'Miao-Yunzai'
  }
  if (normalized === 'yunzai-bot') {
    return 'Yunzai-Bot'
  }
  return normalized ? String(name) : 'Yunzai'
}

function getFooterText() {
  if (footerTextCache) {
    return footerTextCache
  }

  const pluginVersion = packageInfo?.version || '1.0.0'
  let hostName = 'Yunzai'
  let hostVersion = ''

  try {
    const hostPackagePath = path.join(pluginRoot, '..', '..', 'package.json')
    const hostPackage = JSON.parse(fs.readFileSync(hostPackagePath, 'utf8'))
    hostName = formatHostName(hostPackage?.name || hostName)
    hostVersion = hostPackage?.version ? ` ${hostPackage.version}` : ''
  } catch {}

  footerTextCache = `Created By ${hostName}${hostVersion} & ${pluginName} ${pluginVersion}`
  return footerTextCache
}

function formatFooterTime(timestamp = Date.now()) {
  const date = new Date(Number(timestamp) || Date.now())
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function normalizeUsageInfo(usage = null) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const promptTokens = Number(usage.promptTokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input_tokens ?? 0) || 0
  const completionTokens = Number(usage.completionTokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.output_tokens ?? 0) || 0
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? (promptTokens + completionTokens) ?? 0) || 0
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
    return null
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens
  }
}

function renderJournalFooter(meta = {}) {
  const usage = normalizeUsageInfo(meta.usage)
  const generatedAt = formatFooterTime(meta.generatedAt || Date.now())
  const items = [
    getFooterText(),
    generatedAt ? `生成时间 ${generatedAt}` : '',
    usage ? `上下文 Token ${usage.totalTokens}` : ''
  ].filter(Boolean)

  return `
    <div class="journal-footer">
      ${items.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
    </div>
  `
}

function normalizeTheme(theme = 'light') {
  return String(theme || '').toLowerCase() === 'night' ? 'night' : 'light'
}

function getNightJournalCSS() {
  return `
    body.theme-night {
      color: #f4ead8;
      background-color: #141821;
      background-image:
        radial-gradient(rgba(242, 197, 119, 0.16) 1.2px, transparent 1.2px),
        linear-gradient(180deg, #10131b 0%, #1b2230 100%);
    }
    body.theme-night .journal {
      background:
        linear-gradient(180deg, rgba(38,45,59,0.98), rgba(28,34,47,0.98));
      border-color: #e1b66b;
      box-shadow: 0 22px 46px rgba(0,0,0,0.42), 8px 8px 0 rgba(225, 182, 107, 0.22);
    }
    body.theme-night .journal::before {
      background: radial-gradient(circle, rgba(255,236,190,0.28) 0 4px, transparent 4.5px);
    }
    body.theme-night .journal::after {
      background: repeating-linear-gradient(to bottom, rgba(225,182,107,0.4) 0, rgba(225,182,107,0.4) 8px, transparent 8px, transparent 16px);
    }
    body.theme-night .tape-strip {
      background: rgba(106, 141, 189, 0.46);
    }
    body.theme-night .title-sticker {
      background: #202839;
      border-color: #e1b66b;
      box-shadow: 7px 7px 0 rgba(106, 141, 189, 0.35);
    }
    body.theme-night .journal-search .title-sticker,
    body.theme-night .journal-summary .title-sticker,
    body.theme-night .journal-group .title-sticker {
      box-shadow: 7px 7px 0 rgba(106, 141, 189, 0.35);
    }
    body.theme-night .title-sticker h1,
    body.theme-night .title-eyebrow,
    body.theme-night .section-title,
    body.theme-night .chart-title,
    body.theme-night .vertical-chart-title,
    body.theme-night .info-card-title {
      color: #f2c577;
    }
    body.theme-night .journal-search .title-sticker h1,
    body.theme-night .topic-name,
    body.theme-night .quality-title,
    body.theme-night .quality-dimension-name,
    body.theme-night .portrait-name,
    body.theme-night .source-host,
    body.theme-night .supplement-card-title {
      color: #8fd6d2;
    }
    body.theme-night .date-tag {
      background: #2d3d5f;
      color: #f4ead8;
      border-color: #e1b66b;
      box-shadow: 2px 2px 0 rgba(0,0,0,0.28);
    }
    body.theme-night .section,
    body.theme-night .chart-panel,
    body.theme-night .vertical-chart-panel {
      background: #202839;
      border-color: rgba(225,182,107,0.42);
      box-shadow: 4px 4px 0 rgba(0,0,0,0.34);
    }
    body.theme-night .paper-section {
      background-color: #202839;
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 33px,
        rgba(143, 214, 210, 0.18) 33px,
        rgba(143, 214, 210, 0.18) 34px
      );
    }
    body.theme-night .source-section {
      background: linear-gradient(135deg, rgba(31,43,58,0.96), rgba(35,35,49,0.96));
    }
    body.theme-night .billing-section {
      background: linear-gradient(135deg, rgba(32,50,43,0.96), rgba(35,35,49,0.96));
    }
    body.theme-night .quote-section {
      background: linear-gradient(135deg, rgba(58,45,34,0.96), rgba(35,35,49,0.96));
    }
    body.theme-night .metric-card,
    body.theme-night .info-card,
    body.theme-night .topic-card,
    body.theme-night .quality-shell,
    body.theme-night .quality-summary,
    body.theme-night .quality-dimension-card,
    body.theme-night .source-item,
    body.theme-night .quote-card,
    body.theme-night .portrait-card,
    body.theme-night .supplement-card {
      background: rgba(27,34,47,0.92);
      border-color: rgba(225,182,107,0.34);
      box-shadow: 4px 4px 0 rgba(0,0,0,0.28);
    }
    body.theme-night .metric-card::before {
      border-color: rgba(242,197,119,0.32);
    }
    body.theme-night .metric-card.blue::before {
      border-color: rgba(143,214,210,0.36);
    }
    body.theme-night .metric-card-inner {
      background: radial-gradient(circle, rgba(43,53,70,0.98) 45%, rgba(30,38,52,0.98) 100%);
    }
    body.theme-night .metric-card.blue .metric-card-inner {
      background: radial-gradient(circle, rgba(38,58,73,0.98) 45%, rgba(29,43,58,0.98) 100%);
    }
    body.theme-night .metric-label,
    body.theme-night .chart-meta,
    body.theme-night .vertical-chart-label,
    body.theme-night .source-url,
    body.theme-night .source-more,
    body.theme-night .portrait-meta,
    body.theme-night .topic-contributors,
    body.theme-night .quality-subtitle,
    body.theme-night .empty-state,
    body.theme-night .journal-footer span {
      color: #b9ad9c;
    }
    body.theme-night .metric-value,
    body.theme-night .chart-value {
      color: #f2c577;
    }
    body.theme-night .metric-card.blue .metric-value,
    body.theme-night .vertical-chart-value {
      color: #8fd6d2;
    }
    body.theme-night .info-card::before,
    body.theme-night .source-item::before {
      background: rgba(143,214,210,0.28);
    }
    body.theme-night .chart-panel::before,
    body.theme-night .vertical-chart-panel::before {
      background: repeating-linear-gradient(to bottom, rgba(242,197,119,0.42) 0, rgba(242,197,119,0.42) 3px, transparent 3px, transparent 16px);
      border-left-color: rgba(242,197,119,0.5);
    }
    body.theme-night .hero-note {
      background: linear-gradient(135deg, #3a3145, #243a54);
      border-color: rgba(225,182,107,0.45);
      box-shadow: 5px 5px 0 rgba(0,0,0,0.32);
    }
    body.theme-night .hero-kicker,
    body.theme-night .hero-text,
    body.theme-night .rich-paragraph,
    body.theme-night .rich-list,
    body.theme-night .chart-label,
    body.theme-night .topic-detail,
    body.theme-night .quality-summary,
    body.theme-night .quality-dimension-comment,
    body.theme-night .portrait-summary,
    body.theme-night .text-content {
      color: #f4ead8;
    }
    body.theme-night .chart-track {
      background: rgba(242, 197, 119, 0.16);
      border-color: rgba(225,182,107,0.38);
    }
    body.theme-night .chart-fill {
      background:
        repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 5px, rgba(255,255,255,0) 5px 10px),
        linear-gradient(90deg, #d97757 0%, #f2c577 100%);
    }
    body.theme-night .chart-fill.blue,
    body.theme-night .vertical-chart-fill {
      background:
        repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 5px, rgba(255,255,255,0) 5px 10px),
        linear-gradient(180deg, #8fd6d2 0%, #4b8fb1 100%);
    }
    body.theme-night .vertical-chart-track {
      background: rgba(143, 214, 210, 0.14);
      border-color: rgba(143,214,210,0.35);
    }
    body.theme-night .quote-note,
    body.theme-night .topic-contributor,
    body.theme-night .quality-percent,
    body.theme-night .portrait-title,
    body.theme-night .portrait-tag {
      background: rgba(242,197,119,0.16);
      border-color: rgba(242,197,119,0.46);
      color: #f8d792;
    }
    body.theme-night .quote-note-label {
      color: #f2c577;
    }
    body.theme-night .quote-card::before {
      color: rgba(242,197,119,0.22);
    }
    body.theme-night .quote-meta {
      color: #b9ad9c;
    }
    body.theme-night .stamp {
      border-color: rgba(242,197,119,0.62);
      background: rgba(16,19,27,0.42);
    }
    body.theme-night .source-index,
    body.theme-night .topic-index,
    body.theme-night .pin {
      background: #4b8fb1;
    }
    body.theme-night .billing-avatar,
    body.theme-night .quote-avatar,
    body.theme-night .portrait-avatar {
      border-color: rgba(242,197,119,0.52);
      background: #10131b;
    }
    body.theme-night .user-chip {
      border-color: rgba(225,182,107,0.36);
      background: rgba(32,40,57,0.86);
      color: #f4ead8;
      box-shadow: 1px 1px 0 rgba(106,141,189,0.3);
    }
    body.theme-night .user-chip-avatar {
      background: #202839;
    }
    body.theme-night .journal-footer {
      background: linear-gradient(90deg, #182033, #232b3e, #182033);
      border-top-color: rgba(225,182,107,0.36);
    }
  `
}

function getJournalCSS(theme = 'light') {
  return `
    :root {
      --paper-bg: #fdfaf3;
      --paper-dot: rgba(122, 94, 72, 0.14);
      --ink-primary: #5d4037;
      --ink-secondary: #8a6b58;
      --border-soft: #d9c4b0;
      --accent-orange: #ff8a5b;
      --accent-blue: #6ca9dc;
      --accent-yellow: #fff1a8;
      --accent-pink: #ffd8cc;
      --font-title: "YouYuan", "Microsoft YaHei", sans-serif;
      --font-hand: "KaiTi", "STKaiti", "Microsoft YaHei", serif;
      --font-body: "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-body);
      color: var(--ink-primary);
      background-color: var(--paper-bg);
      background-image:
        radial-gradient(var(--paper-dot) 1.2px, transparent 1.2px),
        linear-gradient(180deg, #fffdf9 0%, #f7f0e5 100%);
      background-size: 18px 18px, 100% 100%;
      padding: 24px 14px 32px;
    }
    .journal {
      max-width: 680px;
      margin: 0 auto;
      background: linear-gradient(180deg, rgba(255,253,248,0.98), rgba(255,249,239,0.98));
      border-radius: 28px 18px 28px 18px;
      border: 2px solid #7b5c44;
      box-shadow: 0 18px 40px rgba(90,64,44,0.12), 8px 8px 0 rgba(197,173,147,0.75);
      overflow: hidden;
      position: relative;
    }
    .journal::before {
      content: '';
      position: absolute;
      left: 12px;
      top: 24px;
      bottom: 18px;
      width: 18px;
      background: radial-gradient(circle, #f4ecdf 0 4px, transparent 4.5px);
      background-size: 18px 46px;
      background-repeat: repeat-y;
      z-index: 1;
    }
    .journal::after {
      content: '';
      position: absolute;
      left: 34px;
      top: 18px;
      bottom: 18px;
      width: 2px;
      background: repeating-linear-gradient(to bottom, #e8d5c3 0, #e8d5c3 8px, transparent 8px, transparent 16px);
      z-index: 1;
    }
    .journal-header {
      padding: 28px 22px 16px 52px;
      text-align: center;
      position: relative;
    }
    .tape-strip {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%) rotate(-2deg);
      width: 110px;
      height: 24px;
      background: rgba(255, 204, 188, 0.72);
      border-radius: 6px;
      opacity: 0.92;
    }
    .title-sticker {
      display: inline-block;
      max-width: 100%;
      min-width: 260px;
      padding: 18px 26px 16px;
      border: 3px dashed #7b5c44;
      border-radius: 18px;
      background: #fffefb;
      position: relative;
      box-shadow: 7px 7px 0 var(--accent-pink);
      transform: rotate(-1.5deg);
    }
    .journal-search .title-sticker {
      box-shadow: 7px 7px 0 #cfe6fb;
    }
    .journal-summary .title-sticker {
      box-shadow: 7px 7px 0 #ffd9c8;
    }
    .journal-group .title-sticker {
      box-shadow: 7px 7px 0 #ffe2ac;
    }
    .title-sticker h1 {
      font-family: var(--font-title);
      color: var(--accent-orange);
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 1px;
      word-break: break-word;
    }
    .title-eyebrow {
      color: #9d7152;
      font-family: var(--font-hand);
      font-size: 12px;
      line-height: 1;
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .journal-search .title-sticker h1 {
      color: #4f8fc7;
    }
    .date-tag {
      position: absolute;
      right: -10px;
      bottom: -16px;
      display: inline-block;
      padding: 5px 14px;
      border: 1px solid #7b5c44;
      background: var(--accent-yellow);
      color: var(--ink-primary);
      font-family: var(--font-hand);
      font-size: 13px;
      box-shadow: 2px 2px 0 rgba(123,92,68,0.15);
      transform: rotate(4deg);
      white-space: nowrap;
    }
    .journal-body { padding: 16px 18px 22px 52px; }
    .journal-body > .section:last-child,
    .journal-body > .chart-panel:last-child,
    .journal-body > .vertical-chart-panel:last-child,
    .journal-body > .metric-row:last-child {
      margin-bottom: 0;
    }
    .section {
      background: #fffef9;
      border: 2px solid var(--border-soft);
      border-radius: 16px;
      padding: 18px 16px 16px;
      margin-bottom: 16px;
      position: relative;
      box-shadow: 4px 4px 0 rgba(211,190,167,0.6);
    }
    .paper-section {
      background-color: #fffef9;
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 33px,
        rgba(166, 207, 231, 0.38) 33px,
        rgba(166, 207, 231, 0.38) 34px
      );
    }
    .source-section {
      background: linear-gradient(135deg, rgba(244,250,255,0.95), rgba(255,252,247,0.96));
    }
    .billing-section {
      background: linear-gradient(135deg, rgba(248,255,239,0.96), rgba(255,252,247,0.96));
    }
    .billing-profile {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .billing-avatar,
    .quote-avatar,
    .portrait-avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid rgba(123,92,68,0.28);
      background: #fff;
      flex-shrink: 0;
    }
    .billing-profile-main {
      flex: 1;
      min-width: 0;
    }
    .user-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 150px;
      padding: 1px 7px 1px 2px;
      margin: 0 2px;
      border: 1px solid rgba(123,92,68,0.22);
      border-radius: 999px;
      background: rgba(255,255,255,0.82);
      color: #6a4b35;
      font-size: 12px;
      line-height: 18px;
      vertical-align: -3px;
      box-shadow: 1px 1px 0 rgba(211,190,167,0.45);
    }
    .user-chip-avatar {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      object-fit: cover;
      background: #fff;
      flex-shrink: 0;
    }
    .user-chip-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .quote-section {
      background: linear-gradient(135deg, rgba(255,248,213,0.96), rgba(255,252,240,0.96));
    }
    .section-title {
      color: #c46c3d;
      font-family: var(--font-title);
      font-size: 20px;
      line-height: 1.2;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      padding-right: 46px;
      word-break: break-word;
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
      width: 42px;
      height: 42px;
      border: 2px solid #c46c3d;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      opacity: 0.35;
      transform: rotate(15deg);
      background: rgba(255,255,255,0.45);
    }
    .metric-row {
      display: flex;
      gap: 14px;
      margin-bottom: 18px;
      flex-wrap: wrap;
    }
    .metric-card {
      flex: 1;
      min-width: 0;
      background: #fff;
      padding: 10px;
      border: 1px solid #e7d7c6;
      box-shadow: 3px 3px 8px rgba(0,0,0,0.05);
      background-image: radial-gradient(transparent 48%, #fff 50%);
      background-size: 10px 10px;
      background-position: -5px -5px;
      transform: rotate(-1deg);
      position: relative;
    }
    .metric-card:nth-child(even) {
      transform: rotate(1deg);
    }
    .metric-card::before {
      content: '';
      position: absolute;
      inset: 8px;
      border: 1px dashed #d5c0ad;
      pointer-events: none;
    }
    .metric-card.blue::before {
      border-color: #bdd4ea;
    }
    .metric-card-inner {
      position: relative;
      min-height: 78px;
      padding: 8px 4px 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle, #fff 45%, #fbf8f2 100%);
    }
    .metric-card.blue .metric-card-inner {
      background: radial-gradient(circle, #fff 45%, #f2f8ff 100%);
    }
    .metric-icon {
      font-size: 20px;
      margin-bottom: 6px;
    }
    .metric-label {
      font-family: var(--font-hand);
      font-size: 13px;
      color: var(--ink-secondary);
      margin-bottom: 4px;
      text-align: center;
    }
    .metric-value {
      font-family: var(--font-title);
      font-size: 28px;
      line-height: 1;
      color: var(--accent-orange);
    }
    .metric-card.blue .metric-value {
      color: var(--accent-blue);
    }
    .hero-note {
      margin-bottom: 16px;
      padding: 16px 18px 14px;
      border-radius: 8px;
      background: linear-gradient(135deg, #fff6b7, #fff1a3);
      border: 1px solid #d6c277;
      box-shadow: 5px 5px 0 rgba(214,194,119,0.32);
      position: relative;
      transform: rotate(1deg);
    }
    .hero-note::before {
      content: '';
      position: absolute;
      width: 56px;
      height: 16px;
      left: 18px;
      top: -8px;
      background: rgba(255,255,255,0.45);
      border-radius: 4px;
      transform: rotate(-4deg);
    }
    .hero-kicker {
      color: #7b5c44;
      font-family: var(--font-hand);
      font-size: 12px;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .hero-text {
      color: #4c3a29;
      font-size: 13px;
      line-height: 1.8;
      word-break: break-word;
    }
    .card-stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .info-card {
      background: #fffefb;
      border: 2px solid #dbc9b7;
      border-radius: 14px;
      padding: 14px 14px 12px;
      box-shadow: 4px 4px 0 rgba(212,190,166,0.56);
      position: relative;
      transform: rotate(-0.5deg);
    }
    .info-card:nth-child(even) {
      transform: rotate(0.5deg);
    }
    .info-card::before {
      content: '';
      position: absolute;
      left: 16px;
      top: -9px;
      width: 54px;
      height: 16px;
      border-radius: 4px;
      background: rgba(184, 221, 244, 0.72);
      transform: rotate(-6deg);
    }
    .info-card-title {
      color: #b85c2e;
      font-family: var(--font-title);
      font-size: 17px;
      margin-bottom: 8px;
      padding-right: 20px;
    }
    .chart-panel {
      margin-bottom: 16px;
      padding: 18px 16px 16px 28px;
      border-radius: 8px 18px 18px 8px;
      background: #fff;
      border: 2px solid var(--border-soft);
      box-shadow: 5px 5px 0 rgba(211,190,167,0.56);
      position: relative;
    }
    .chart-panel::before,
    .vertical-chart-panel::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 18px;
      bottom: 18px;
      width: 8px;
      background: repeating-linear-gradient(to bottom, #b5b5b5 0, #b5b5b5 3px, transparent 3px, transparent 16px);
      border-left: 2px solid #9a9a9a;
    }
    .chart-title {
      color: #b85c2e;
      font-family: var(--font-title);
      font-size: 18px;
      margin-bottom: 12px;
    }
    .chart-row {
      margin-bottom: 12px;
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
      font-family: var(--font-hand);
      font-size: 14px;
      color: #5a4a3a;
      word-break: break-word;
    }
    .chart-value {
      color: #b85c2e;
      font-weight: bold;
      white-space: nowrap;
    }
    .chart-track {
      height: 14px;
      border-radius: 999px;
      background: rgba(255, 241, 168, 0.55);
      border: 1px solid #d6c5aa;
      overflow: hidden;
      position: relative;
    }
    .chart-fill {
      height: 100%;
      border-radius: 999px;
      background:
        repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 5px, rgba(255,255,255,0) 5px 10px),
        linear-gradient(90deg, #ff9b73 0%, #ffc16e 100%);
    }
    .chart-fill.blue {
      background:
        repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 5px, rgba(255,255,255,0) 5px 10px),
        linear-gradient(90deg, #71b5e6 0%, #9fd2f2 100%);
    }
    .vertical-chart-panel {
      margin-bottom: 16px;
      padding: 18px 16px 16px 28px;
      border-radius: 8px 18px 18px 8px;
      background: #fff;
      border: 2px solid var(--border-soft);
      box-shadow: 5px 5px 0 rgba(211,190,167,0.56);
      position: relative;
    }
    .vertical-chart-title {
      color: #b85c2e;
      font-family: var(--font-title);
      font-size: 18px;
      margin-bottom: 12px;
    }
    .vertical-chart-grid {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      min-height: 182px;
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
      color: #5b90c0;
      font-size: 11px;
      font-weight: bold;
      line-height: 1;
    }
    .vertical-chart-track {
      width: 100%;
      max-width: 28px;
      height: 118px;
      border-radius: 999px;
      border: 1px solid #c7dcec;
      background: rgba(205, 233, 249, 0.5);
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
    }
    .vertical-chart-fill {
      width: 100%;
      border-radius: 999px;
      background:
        repeating-linear-gradient(180deg, rgba(255,255,255,0.18) 0 5px, rgba(255,255,255,0) 5px 10px),
        linear-gradient(180deg, #9ecff0 0%, #6aa8d8 100%);
      min-height: 8px;
    }
    .vertical-chart-label {
      color: #6e5a48;
      font-family: var(--font-hand);
      font-size: 12px;
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
      gap: 12px;
    }
    .source-item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      background: rgba(255,255,255,0.9);
      border: 2px solid #d9dff0;
      border-radius: 14px;
      box-shadow: 4px 4px 0 rgba(190, 208, 228, 0.45);
      position: relative;
    }
    .source-item::before {
      content: '';
      position: absolute;
      right: 16px;
      top: -8px;
      width: 48px;
      height: 16px;
      border-radius: 4px;
      background: rgba(255, 241, 168, 0.8);
      transform: rotate(7deg);
    }
    .source-index {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: #6ca9dc;
      color: #fff;
      font-size: 13px;
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
      color: #5f94c0;
      font-size: 13px;
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
    .source-more {
      color: #8d745d;
      font-size: 12px;
      line-height: 1.7;
      padding: 9px 12px;
      background: rgba(255,255,255,0.55);
      border: 1px dashed rgba(123,92,68,0.28);
      border-radius: 12px;
    }
    .empty-state {
      color: #a18467;
      font-size: 12px;
      line-height: 1.7;
    }
    .quote-card {
      background: rgba(255,255,255,0.82);
      border: 2px solid #e0cf8f;
      border-radius: 18px;
      padding: 14px 14px 12px;
      margin-bottom: 12px;
      box-shadow: 4px 4px 0 rgba(224, 207, 143, 0.42);
      position: relative;
    }
    .quote-card:last-child {
      margin-bottom: 0;
    }
    .quote-card::before {
      content: '"';
      position: absolute;
      left: 14px;
      top: 8px;
      font-size: 30px;
      line-height: 1;
      color: rgba(196, 108, 61, 0.2);
      font-family: Georgia, serif;
    }
    .quote-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 11px;
      color: #9a806a;
    }
    .quote-body {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding-left: 18px;
      position: relative;
    }
    .quote-main {
      flex: 1;
      min-width: 0;
    }
    .quote-author {
      font-weight: bold;
    }
    .quote-content {
      padding-left: 0;
    }
    .quote-note {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(255,245,183,0.92), rgba(255,239,160,0.92));
      border: 1px dashed #ccb56e;
      color: #6a5428;
    }
    .quote-note-label {
      font-family: var(--font-hand);
      font-size: 12px;
      color: #8a6726;
      margin-bottom: 4px;
    }
    .topic-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .topic-card {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 12px;
      padding: 13px 14px;
      background: rgba(255,255,255,0.86);
      border: 2px solid #d7cbe8;
      border-radius: 14px;
      box-shadow: 4px 4px 0 rgba(199, 188, 220, 0.4);
      position: relative;
    }
    .topic-card:nth-child(even) {
      transform: rotate(0.45deg);
    }
    .topic-card:nth-child(odd) {
      transform: rotate(-0.35deg);
    }
    .topic-index {
      width: 32px;
      height: 32px;
      border-radius: 12px;
      background: #ff8a5b;
      color: #fff;
      font-family: var(--font-title);
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 2px 2px 0 rgba(123,92,68,0.18);
    }
    .topic-main {
      min-width: 0;
    }
    .topic-name {
      color: #b85c2e;
      font-family: var(--font-title);
      font-size: 16px;
      line-height: 1.35;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .topic-contributors {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      color: #8d745d;
      font-size: 11px;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    .topic-contributor {
      display: inline-flex;
      max-width: 100%;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(207,230,251,0.72);
      border: 1px dashed rgba(95,148,192,0.42);
      color: #507ea3;
      word-break: break-word;
    }
    .topic-detail {
      color: #5a4a3a;
      font-size: 12px;
      line-height: 1.75;
      word-break: break-word;
    }
    .quality-shell {
      padding: 14px;
      border: 2px dashed #d4a574;
      border-radius: 14px;
      background: rgba(255,255,255,0.78);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.62);
    }
    .quality-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px dashed rgba(123,92,68,0.24);
    }
    .quality-title {
      color: #b85c2e;
      font-family: var(--font-title);
      font-size: 17px;
      line-height: 1.35;
      word-break: break-word;
    }
    .quality-subtitle {
      color: #8d745d;
      font-family: var(--font-hand);
      font-size: 12px;
      line-height: 1.6;
      text-align: right;
      max-width: 42%;
      word-break: break-word;
    }
    .quality-bar {
      display: flex;
      height: 28px;
      overflow: hidden;
      border: 1px solid rgba(123,92,68,0.25);
      border-radius: 999px;
      background: rgba(255,255,255,0.72);
      margin-bottom: 14px;
    }
    .quality-segment {
      min-width: 7%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      text-shadow: 1px 1px 0 rgba(0,0,0,0.28);
      overflow: hidden;
      white-space: nowrap;
    }
    .quality-dimension-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .quality-dimension-card {
      padding: 11px 12px;
      background: rgba(255,250,240,0.92);
      border: 1px dashed #d4a574;
      border-radius: 10px;
      box-shadow: 2px 2px 0 rgba(211,190,167,0.32);
      min-width: 0;
    }
    .quality-dimension-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }
    .quality-dimension-name {
      color: #b85c2e;
      font-weight: bold;
      font-size: 13px;
      line-height: 1.35;
      word-break: break-word;
    }
    .quality-percent {
      flex-shrink: 0;
      color: #8a6726;
      font-size: 10px;
      line-height: 1.2;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(255,245,183,0.92);
      border: 1px dashed #ccb56e;
    }
    .quality-dimension-comment {
      color: #5a4a3a;
      font-size: 12px;
      line-height: 1.65;
      word-break: break-word;
    }
    .quality-summary {
      color: #4c3a29;
      font-size: 13px;
      line-height: 1.75;
      padding: 10px 12px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(255,246,183,0.8), rgba(255,255,255,0.78));
      border: 1px solid rgba(214,194,119,0.48);
      word-break: break-word;
    }
    .portrait-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .portrait-card {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      background: rgba(255,255,255,0.88);
      border: 1px solid #d9dff0;
      border-radius: 14px;
      padding: 12px;
      box-shadow: 3px 3px 0 rgba(190, 208, 228, 0.35);
      min-width: 0;
    }
    .portrait-main {
      flex: 1;
      min-width: 0;
    }
    .portrait-name {
      color: #5f94c0;
      font-weight: bold;
      font-size: 13px;
      line-height: 1.3;
      word-break: break-word;
      margin-bottom: 4px;
    }
    .portrait-title {
      display: inline-flex;
      max-width: 100%;
      color: #9b5d28;
      font-family: var(--font-hand);
      font-size: 12px;
      line-height: 1.35;
      padding: 2px 7px;
      margin-bottom: 5px;
      border-radius: 999px;
      background: rgba(255,226,172,0.72);
      border: 1px dashed rgba(196,108,61,0.36);
      word-break: break-word;
    }
    .portrait-meta {
      color: #9a806a;
      font-size: 11px;
      line-height: 1.6;
      margin-bottom: 6px;
    }
    .portrait-summary {
      color: #5a4a3a;
      font-size: 12px;
      line-height: 1.7;
      word-break: break-word;
      margin-bottom: 6px;
    }
    .portrait-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .portrait-tag {
      color: #6a5428;
      font-size: 10px;
      line-height: 1.3;
      background: rgba(255,245,183,0.92);
      border: 1px dashed #ccb56e;
      border-radius: 999px;
      padding: 3px 7px;
      max-width: 100%;
      word-break: break-word;
    }
    .supplement-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .supplement-card {
      background: rgba(255,255,255,0.86);
      border: 1px dashed #b9cfe2;
      border-radius: 14px;
      padding: 12px 14px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55);
    }
    .supplement-card-title {
      font-family: var(--font-hand);
      font-size: 14px;
      color: #5f94c0;
      margin-bottom: 8px;
    }
    .journal-footer {
      background: linear-gradient(90deg, #f5ead9, #fffdf7, #f5ead9);
      padding: 12px 24px 14px 52px;
      border-top: 1px dashed #d4a574;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px 14px;
    }
    .journal-footer span {
      color: #a98769;
      font-family: var(--font-hand);
      font-size: 12px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
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
    @media (max-width: 560px) {
      .portrait-grid,
      .quality-dimension-grid {
        grid-template-columns: 1fr;
      }
      .quality-head {
        flex-direction: column;
      }
      .quality-subtitle {
        max-width: 100%;
        text-align: left;
      }
      .topic-card {
        grid-template-columns: 32px minmax(0, 1fr);
      }
      .quote-meta {
        flex-direction: column;
        gap: 3px;
      }
    }
    ${normalizeTheme(theme) === 'night' ? getNightJournalCSS() : ''}
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

function normalizeUserMap(userMap = {}) {
  if (userMap instanceof Map) {
    return Object.fromEntries(userMap.entries())
  }
  return userMap && typeof userMap === 'object' ? userMap : {}
}

function getUserChipData(userId = '', options = {}) {
  const actualUserId = String(userId || '').trim()
  if (!actualUserId) {
    return null
  }

  const userMap = normalizeUserMap(options.userMap)
  const user = userMap[actualUserId] || {}
  const name = String(user.nickname || user.name || user.card || actualUserId).trim()
  return {
    userId: actualUserId,
    name,
    avatar: user.avatar || getAvatarUrl(actualUserId)
  }
}

function getUserChipDataByName(name = '', options = {}) {
  const actualName = String(name || '').trim()
  if (!actualName) {
    return null
  }

  const userMap = normalizeUserMap(options.userMap)
  const matches = Object.values(userMap)
    .filter(user => {
      const nickname = String(user?.nickname || user?.name || user?.card || '').trim()
      return nickname && nickname === actualName
    })

  if (matches.length !== 1) {
    return null
  }

  const user = matches[0]
  const userId = String(user.userId || user.user_id || '').trim()
  if (!userId) {
    return null
  }

  return {
    userId,
    name: actualName,
    avatar: user.avatar || getAvatarUrl(userId)
  }
}

function renderUserChip(userId = '', options = {}) {
  const user = getUserChipData(userId, options)
  if (!user) {
    return escapeHtml(userId)
  }

  return `
    <span class="user-chip" title="${escapeHtml(`${user.name} (${user.userId})`)}">
      ${user.avatar ? `<img class="user-chip-avatar" src="${escapeHtml(user.avatar)}" alt="">` : ''}
      <span class="user-chip-name">${escapeHtml(user.name)}</span>
    </span>
  `
}

function renderUserChipByName(name = '', options = {}) {
  const user = getUserChipDataByName(name, options)
  if (!user) {
    return `<span class="topic-contributor">${escapeHtml(name)}</span>`
  }

  return `
    <span class="topic-contributor user-chip" title="${escapeHtml(`${user.name} (${user.userId})`)}">
      ${user.avatar ? `<img class="user-chip-avatar" src="${escapeHtml(user.avatar)}" alt="">` : ''}
      <span class="user-chip-name">${escapeHtml(user.name)}</span>
    </span>
  `
}

function renderInlineRichText(text = '', options = {}) {
  const source = String(text || '')
  const pattern = /(\[(\d{5,12})\]|@(\d{5,12}))/g
  let html = ''
  let lastIndex = 0
  let match = pattern.exec(source)

  while (match) {
    html += escapeHtml(source.slice(lastIndex, match.index))
    const userId = match[2] || match[3] || ''
    html += renderUserChip(userId, options)
    lastIndex = match.index + match[0].length
    match = pattern.exec(source)
  }

  html += escapeHtml(source.slice(lastIndex))
  return html
}

function renderListHtml(items = [], options = {}) {
  if (items.length === 0) {
    return ''
  }

  return `
    <ul class="rich-list">
      ${items.map(item => `<li>${renderInlineRichText(item, options)}</li>`).join('')}
    </ul>
  `
}

function renderTextBlock(block = '', options = {}) {
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
    segments.push(`<div class="rich-paragraph">${renderInlineRichText(paragraphLines.join('\n'), options)}</div>`)
    paragraphLines = []
  }

  const flushList = () => {
    if (listItems.length === 0) {
      return
    }
    segments.push(renderListHtml(listItems, options))
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

function renderRichTextHtml(text = '', options = {}) {
  const blocks = normalizeTextBlocks(text)
  if (blocks.length === 0) {
    return '<div class="empty-state">暂无内容</div>'
  }

  return blocks.map(block => renderTextBlock(block, options)).join('')
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
      <div class="metric-card-inner">
        ${icon ? `<div class="metric-icon">${icon}</div>` : ''}
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(String(value))}</div>
      </div>
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

function renderJournalHeader(title, eyebrow = '胡桃的观察手帐') {
  return `
    <div class="journal-header">
      <div class="tape-strip"></div>
      <div class="title-sticker">
        ${eyebrow ? `<div class="title-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
        <h1>${escapeHtml(title)}</h1>
        <div class="date-tag">${new Date().toLocaleString('zh-CN')} · 胡桃的手帐</div>
      </div>
    </div>
  `
}

function renderJournalShell({ title = '', eyebrow = '', variant = 'summary', theme = 'light', body = '', footerMeta = {} } = {}) {
  const normalizedTheme = normalizeTheme(theme)
  const bodyClass = normalizedTheme === 'night' ? 'theme-night' : 'theme-light'
  const journalClass = `journal journal-${variant || 'summary'}`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS(normalizedTheme)}</style></head>
    <body class="${bodyClass}"><div class="${journalClass}">
      ${renderJournalHeader(title, eyebrow)}
      <div class="journal-body">
        ${body}
      </div>
      ${renderJournalFooter(footerMeta)}
    </div></body></html>`
}

function renderSnapshotNote(text = '', kicker = '摘要快照') {
  const actualText = String(text || '').trim()
  if (!actualText) {
    return ''
  }

  return `
    <div class="hero-note">
      <div class="hero-kicker">${escapeHtml(kicker)}</div>
      <div class="hero-text">${escapeHtml(actualText)}</div>
    </div>
  `
}

function getAvatarUrl(userId = '') {
  const actualUserId = String(userId || '').trim()
  return actualUserId ? `https://q1.qlogo.cn/g?b=qq&s=0&nk=${actualUserId}` : ''
}

function parseBillingUser(text = '') {
  const match = String(text || '').match(/(?:^|\n)使用者：(.+?)(?:。|\n|$)/)
  if (!match) {
    return null
  }

  const label = String(match[1] || '').trim()
  const idMatch = label.match(/\((\d+)\)$/)
  const userId = idMatch?.[1] || ''
  const name = idMatch ? label.replace(/\(\d+\)$/, '').trim() : label
  return {
    name,
    userId,
    avatar: getAvatarUrl(userId)
  }
}

function stripBillingUserLine(text = '') {
  return String(text || '').replace(/^使用者：.+?(?:。|\n)/, '').trim()
}

function renderBillingSection(text = '') {
  const actualText = String(text || '').trim()
  if (!actualText) {
    return ''
  }
  const user = parseBillingUser(actualText)
  const billingText = user ? stripBillingUserLine(actualText) : actualText

  return `
    <div class="section billing-section">
      <div class="section-title">扣费信息</div>
      ${user
        ? `
          <div class="billing-profile">
            ${user.avatar ? `<img class="billing-avatar" src="${escapeHtml(user.avatar)}" alt="">` : ''}
            <div class="billing-profile-main">
              <div class="portrait-name">${escapeHtml(user.name || user.userId || '未知用户')}</div>
              ${user.userId ? `<div class="portrait-meta">QQ ${escapeHtml(user.userId)}</div>` : ''}
              ${renderRichTextHtml(billingText)}
            </div>
          </div>
        `
        : renderRichTextHtml(billingText)}
    </div>
  `
}

function renderSection({ title = '', content = '', className = '', stamp = '' } = {}) {
  const actualContent = String(content || '').trim()
  if (!actualContent) {
    return ''
  }

  return `
    <div class="section ${className}">
      ${stamp ? `<div class="stamp">${escapeHtml(stamp)}</div>` : ''}
      ${title ? `<div class="section-title">${escapeHtml(title)}</div>` : ''}
      ${actualContent}
    </div>
  `
}

function renderInfoCard(title = '', content = '', options = {}) {
  return `
    <div class="info-card">
      <div class="info-card-title">${escapeHtml(title || '内容')}</div>
      ${renderRichTextHtml(content, options)}
    </div>
  `
}

function renderStructuredContentSection(content = '', title = '核心内容', stamp = 'NOTE', options = {}) {
  const actualContent = String(content || '').trim()
  if (!actualContent) {
    return ''
  }

  const sections = parseBracketSections(actualContent)
  const contentHtml = sections.length > 0
    ? `
      <div class="card-stack">
        ${sections.map(item => renderInfoCard(item.title, item.content, options)).join('')}
      </div>
    `
    : renderRichTextHtml(actualContent, options)

  return renderSection({
    title,
    className: 'paper-section',
    stamp,
    content: contentHtml
  })
}

function renderNoticeSection(notices = []) {
  const actualNotices = Array.isArray(notices) ? notices.filter(Boolean) : []
  if (actualNotices.length === 0) {
    return ''
  }

  return renderSection({
    title: '处理提示',
    className: 'source-section',
    stamp: 'TIP',
    content: renderRichTextHtml(actualNotices.map(item => `• ${item}`).join('\n'))
  })
}

function renderSourceSection(citations = [], hiddenSourceCount = 0) {
  const items = Array.isArray(citations) ? citations.filter(Boolean) : []
  if (items.length === 0 && hiddenSourceCount <= 0) {
    return ''
  }

  const content = `
    <div class="source-list">
      ${items.map((item, index) => `
        <div class="source-item">
          <div class="source-index">${index + 1}</div>
          <div class="source-main">
            <div class="source-host">${escapeHtml(getHostLabel(item))}</div>
            <div class="source-url">${escapeHtml(item)}</div>
          </div>
        </div>
      `).join('')}
      ${hiddenSourceCount > 0
        ? `<div class="source-more">已隐藏 ${hiddenSourceCount} 个参考来源，可在锅巴调整搜索来源显示上限。</div>`
        : ''}
    </div>
  `

  return renderSection({
    title: '参考来源',
    className: 'source-section',
    stamp: 'SRC',
    content
  })
}

function renderSupplementSections(extraSections = [], options = {}) {
  const items = Array.isArray(extraSections) ? extraSections.filter(item => item?.title || item?.content) : []
  if (items.length === 0) {
    return ''
  }

  return renderSection({
    title: '补充观察',
    className: 'source-section',
    stamp: 'MORE',
    content: `
      <div class="supplement-list">
        ${items.map(item => `
          <div class="supplement-card">
            <div class="supplement-card-title">${escapeHtml(item.title || '补充信息')}</div>
            ${renderRichTextHtml(item.content || '', options)}
          </div>
        `).join('')}
      </div>
    `
  })
}

function renderTopicSection(topics = [], topicSummary = '', isMemberMode = false, options = {}) {
  const items = (Array.isArray(topics) ? topics : [])
    .filter(item => item?.topic || item?.detail)
    .slice(0, 5)
  if (items.length === 0) {
    return topicSummary
      ? renderSection({
        title: isMemberMode ? '成员话题总结' : '话题总结',
        className: 'paper-section',
        stamp: 'TOPIC',
        content: renderRichTextHtml(topicSummary, options)
      })
      : ''
  }

  const summaryHtml = topicSummary ? `
    <div class="topic-summary">
      ${renderRichTextHtml(topicSummary, options)}
    </div>
  ` : ''

  return renderSection({
    title: isMemberMode ? '成员今日话题' : '今日话题',
    className: 'paper-section',
    stamp: 'TOPIC',
    content: `
      <div class="topic-list">
        ${items.map((item, index) => `
          <div class="topic-card">
            <div class="topic-index">${index + 1}</div>
            <div class="topic-main">
              <div class="topic-name">${escapeHtml(item.topic || `话题 ${index + 1}`)}</div>
              ${(item.contributors || []).length > 0
                ? `<div class="topic-contributors">${item.contributors.slice(0, 5).map(name => renderUserChipByName(name, options)).join('')}</div>`
                : ''}
              <div class="topic-detail">${renderInlineRichText(item.detail || '', options)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      ${summaryHtml}
    `
  })
}

function renderHighlightSection(highlights = [], isMemberMode = false, options = {}) {
  const items = Array.isArray(highlights) ? highlights : []
  if (items.length === 0) {
    return ''
  }

  return renderSection({
    title: isMemberMode ? '成员消息精选' : '群消息精选',
    className: 'quote-section',
    stamp: 'BEST',
    content: items.map(item => `
      <div class="quote-card">
        <div class="quote-body">
          ${item.avatar ? `<img class="quote-avatar" src="${escapeHtml(item.avatar)}" alt="">` : ''}
          <div class="quote-main">
            <div class="quote-meta">
              <span class="quote-author">${escapeHtml(item.sender || '匿名')}</span>
              <span>${escapeHtml(item.time || '')}</span>
            </div>
            <div class="quote-content">${renderRichTextHtml(item.content || '', options)}</div>
            ${item.roast ? `
              <div class="quote-note">
                <div class="quote-note-label">胡桃锐评</div>
                ${renderRichTextHtml(item.roast, options)}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `).join('')
  })
}

function renderQualityReviewSection(qualityReview = null, isMemberMode = false, options = {}) {
  const review = qualityReview && typeof qualityReview === 'object' ? qualityReview : null
  if (!review) {
    return ''
  }

  const dimensions = (Array.isArray(review.dimensions) ? review.dimensions : [])
    .map(item => ({
      name: String(item?.name || '').trim(),
      percentage: Math.max(0, Math.min(Number(item?.percentage) || 0, 100)),
      comment: String(item?.comment || '').trim()
    }))
    .filter(item => item.name || item.comment)
    .slice(0, 6)
  const hasContent = review.title || review.subtitle || review.summary || dimensions.length > 0
  if (!hasContent) {
    return ''
  }

  const colors = ['#ff8a5b', '#6ca9dc', '#4db6ac', '#d980a6', '#d4a574', '#8f90d8']
  const total = dimensions.reduce((sum, item) => sum + item.percentage, 0)
  const barItems = dimensions.map((item, index) => {
    const width = total > 0 ? Math.max(7, Math.round((item.percentage / total) * 100)) : Math.max(12, Math.round(100 / Math.max(dimensions.length, 1)))
    return { ...item, width, color: colors[index % colors.length] }
  })

  return renderSection({
    title: isMemberMode ? '个人表现锐评' : '群聊质量锐评',
    className: 'source-section quality-section',
    stamp: 'RATE',
    content: `
      <div class="quality-shell">
        <div class="quality-head">
          <div class="quality-title">${escapeHtml(review.title || (isMemberMode ? '成员互动观察' : '今日群聊主题'))}</div>
          ${review.subtitle ? `<div class="quality-subtitle">${escapeHtml(review.subtitle)}</div>` : ''}
        </div>
        ${barItems.length > 0
          ? `
            <div class="quality-bar">
              ${barItems.map(item => `
                <div class="quality-segment" style="width:${item.width}%; background:${item.color};">${escapeHtml(item.name)}</div>
              `).join('')}
            </div>
          `
          : ''}
        ${dimensions.length > 0
          ? `
            <div class="quality-dimension-grid">
              ${dimensions.map((item, index) => `
                <div class="quality-dimension-card" style="border-color:${colors[index % colors.length]};">
                  <div class="quality-dimension-head">
                    <div class="quality-dimension-name">${escapeHtml(item.name || '观察项')}</div>
                    ${item.percentage > 0 ? `<div class="quality-percent">${escapeHtml(`${item.percentage}%`)}</div>` : ''}
                  </div>
                  <div class="quality-dimension-comment">${renderInlineRichText(item.comment || '', options)}</div>
                </div>
              `).join('')}
            </div>
          `
          : ''}
        ${review.summary ? `<div class="quality-summary">${renderInlineRichText(review.summary, options)}</div>` : ''}
      </div>
    `
  })
}

function renderUserPortraits(portraits = [], isMemberMode = false, options = {}) {
  const items = (Array.isArray(portraits) ? portraits : []).filter(item => item?.nickname || item?.userId)
  if (items.length === 0) {
    return ''
  }

  return renderSection({
    title: isMemberMode ? '群友画像' : '精选用户画像',
    className: 'source-section',
    stamp: 'USER',
    content: `
      <div class="portrait-grid">
        ${items.map(item => `
          <div class="portrait-card">
            ${item.avatar ? `<img class="portrait-avatar" src="${escapeHtml(item.avatar)}" alt="">` : ''}
            <div class="portrait-main">
              <div class="portrait-name">${escapeHtml(item.nickname || item.userId || '未知成员')}</div>
              ${item.title ? `<div class="portrait-title">${escapeHtml(item.title)}</div>` : ''}
              <div class="portrait-meta">${escapeHtml([
                Number(item.messageCount) > 0 ? `${item.messageCount} 条消息` : '',
                item.mbti ? `MBTI ${item.mbti}` : '',
                item.latestTime ? `最近 ${item.latestTime}` : ''
              ].filter(Boolean).join(' · '))}</div>
              <div class="portrait-summary">${renderInlineRichText(item.summary || '', options)}</div>
              ${(item.tags || []).length > 0
                ? `<div class="portrait-tags">${item.tags.map(tag => `<span class="portrait-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
                : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `
  })
}

export function generateHutaoHTML(title, content, stats = null, notices = [], options = {}) {
  const billingText = String(options?.billingText || '').trim()
  const theme = normalizeTheme(options?.theme)
  const footerMeta = options?.footerMeta || options?.generationInfo || {}
  const previewText = getPreviewText(content)
  const body = [
    renderSnapshotNote(previewText, '摘要快照'),
    renderStructuredContentSection(content, '核心内容', 'NOTE'),
    renderNoticeSection(notices),
    renderBillingSection(billingText)
  ].join('')

  return renderJournalShell({
    title,
    eyebrow: '内容总结 · 摘要手帐',
    variant: 'summary',
    theme,
    body,
    footerMeta
  })
}

export function generateSearchHTML(keyword, content, citations = [], options = {}) {
  const billingText = String(options?.billingText || '').trim()
  const hiddenSourceCount = Math.max(0, Number(options?.hiddenSourceCount) || 0)
  const theme = normalizeTheme(options?.theme)
  const footerMeta = options?.footerMeta || options?.generationInfo || {}
  const previewText = getPreviewText(content)
  const body = [
    renderSnapshotNote(previewText, '检索快照'),
    renderStructuredContentSection(content, '整理结果', 'INFO'),
    renderSourceSection(citations, hiddenSourceCount),
    renderBillingSection(billingText)
  ].join('')

  return renderJournalShell({
    title: keyword,
    eyebrow: '百科搜索 · 来源整理',
    variant: 'search',
    theme,
    body,
    footerMeta
  })
}

export function generateGroupSummaryHTML(title, parsedContent, data = {}) {
  const {
    messageCount = 0,
    memberCount = 0,
    sortedMembers = [],
    memberStats = [],
    hourlyActivity = {},
    isMemberMode = false,
    billingText = '',
    userPortraits = [],
    userMap = {},
    generationInfo = {},
    theme = 'light'
  } = data
  const normalizedTheme = normalizeTheme(theme)
  const richOptions = { userMap }
  const {
    topicSummary = '',
    topics = [],
    highlights = [],
    qualityReview = null,
    extraSections = []
  } = parsedContent || {}
  const displayTitle = isMemberMode ? '群友画像' : title
  const rankItems = Array.isArray(memberStats) && memberStats.length > 0
    ? memberStats.map(item => [item.nickname || item.userId || '未知成员', item.count || 0])
    : sortedMembers
  const rankChartHtml = !isMemberMode && rankItems.length > 0
    ? renderBarChart(
      rankItems.slice(0, 10).map(([name, count], index) => ({
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
        ${renderMetricCard('', '相关消息', messageCount)}
      </div>
    `
    : `
      <div class="metric-row">
        ${renderMetricCard('', '消息数量', messageCount)}
        ${renderMetricCard('', '活跃成员', memberCount, 'blue')}
      </div>
    `

  const topicHtml = renderTopicSection(topics, topicSummary, isMemberMode, richOptions)
  const qualityHtml = renderQualityReviewSection(qualityReview, isMemberMode, richOptions)
  const highlightsHtml = renderHighlightSection(highlights, isMemberMode, richOptions)
  const extraSectionsHtml = renderSupplementSections(extraSections, richOptions)
  const userPortraitsHtml = renderUserPortraits(userPortraits, isMemberMode, richOptions)
  const billingHtml = renderBillingSection(billingText)
  const body = isMemberMode
    ? [
        statsHtml,
        topicHtml,
        userPortraitsHtml,
        qualityHtml,
        highlightsHtml,
        activityChartHtml,
        extraSectionsHtml,
        billingHtml
      ].join('')
    : [
        statsHtml,
        rankChartHtml,
        activityChartHtml,
        topicHtml,
        qualityHtml,
        highlightsHtml,
        userPortraitsHtml,
        extraSectionsHtml,
        billingHtml
      ].join('')

  return renderJournalShell({
    title: displayTitle,
    eyebrow: isMemberMode ? '成员发言日报 · 群友画像' : '群聊日报 · 今日切片',
    variant: 'group',
    theme: normalizedTheme,
    body,
    footerMeta: generationInfo
  })
}

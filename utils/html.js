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

function getJournalCSS() {
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
      padding: 2px 4px;
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
      text-align: center;
      border-top: 1px dashed #d4a574;
    }
    .journal-footer span {
      color: #a98769;
      font-family: var(--font-hand);
      font-size: 12px;
      letter-spacing: 0.5px;
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

function renderJournalHeader(title, icon = '') {
  return `
    <div class="journal-header">
      <div class="tape-strip"></div>
      <div class="title-sticker">
        <h1>${escapeHtml(title)}</h1>
        <div class="date-tag">${new Date().toLocaleString('zh-CN')} · 胡桃的手帐</div>
      </div>
    </div>
  `
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

function renderUserPortraits(portraits = []) {
  const items = (Array.isArray(portraits) ? portraits : []).filter(item => item?.nickname || item?.userId)
  if (items.length === 0) {
    return ''
  }

  return `
    <div class="section source-section">
      <div class="section-title">精选用户画像</div>
      <div class="portrait-grid">
        ${items.map(item => `
          <div class="portrait-card">
            ${item.avatar ? `<img class="portrait-avatar" src="${escapeHtml(item.avatar)}" alt="">` : ''}
            <div class="portrait-main">
              <div class="portrait-name">${escapeHtml(item.nickname || item.userId || '未知成员')}</div>
              <div class="portrait-meta">${escapeHtml(`${item.messageCount || 0} 条消息${item.latestTime ? ` · 最近 ${item.latestTime}` : ''}`)}</div>
              <div class="portrait-summary">${escapeHtml(item.summary || '')}</div>
              ${(item.tags || []).length > 0
                ? `<div class="portrait-tags">${item.tags.map(tag => `<span class="portrait-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
                : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

export function generateHutaoHTML(title, content, stats = null, notices = [], options = {}) {
  const actualNotices = Array.isArray(notices) ? notices.filter(Boolean) : []
  const billingText = String(options?.billingText || '').trim()
  const sections = parseBracketSections(content)
  const previewText = getPreviewText(content)
  const contentHtml = content
    ? `
      <div class="section paper-section">
        <div class="section-title">核心内容</div>
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
  const noticeHtml = actualNotices.length > 0
    ? `
      <div class="section source-section">
        <div class="section-title">处理提示</div>
        ${renderRichTextHtml(actualNotices.map(item => `• ${item}`).join('\n'))}
      </div>
    `
    : ''
  const billingHtml = renderBillingSection(billingText)

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal journal-summary">
      ${renderJournalHeader(title, '🔥')}
      <div class="journal-body">
        ${renderSnapshotNote(previewText, '摘要快照')}
        ${contentHtml}
        ${noticeHtml}
        ${billingHtml}
      </div>
      <div class="journal-footer"><span>${escapeHtml(getFooterText())}</span></div>
    </div></body></html>`
}

export function generateSearchHTML(keyword, content, citations = [], options = {}) {
  const billingText = String(options?.billingText || '').trim()
  const hiddenSourceCount = Math.max(0, Number(options?.hiddenSourceCount) || 0)
  const sections = parseBracketSections(content)
  const previewText = getPreviewText(content)

  const contentHtml = content
    ? `
      <div class="section paper-section">
        <div class="section-title">核心内容</div>
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
      <div class="section source-section">
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
          ${hiddenSourceCount > 0
            ? `<div class="source-more">已隐藏 ${hiddenSourceCount} 个参考来源，可在锅巴调整搜索来源显示上限。</div>`
            : ''}
        </div>
      </div>
    `
    : ''
  const billingHtml = renderBillingSection(billingText)

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal journal-search">
      ${renderJournalHeader(keyword, '🔍')}
      <div class="journal-body">
        ${renderSnapshotNote(previewText, '摘要快照')}
        ${contentHtml}
        ${citationsHtml}
        ${billingHtml}
      </div>
      <div class="journal-footer"><span>${escapeHtml(getFooterText())}</span></div>
    </div></body></html>`
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
    userPortraits = []
  } = data
  const { topicSummary = '', highlights = [], extraSections = [] } = parsedContent || {}
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

  const topicHtml = topicSummary
    ? `
      <div class="section paper-section">
        <div class="stamp">📝</div>
        <div class="section-title">话题总结</div>
        ${renderRichTextHtml(topicSummary)}
      </div>
    `
    : ''

  const highlightsHtml = highlights.length > 0
    ? `
      <div class="section quote-section">
        <div class="section-title">${isMemberMode ? '成员消息精选' : '群消息精选'}</div>
        ${highlights.map(item => `
          <div class="quote-card">
            <div class="quote-body">
              ${item.avatar ? `<img class="quote-avatar" src="${escapeHtml(item.avatar)}" alt="">` : ''}
              <div class="quote-main">
                <div class="quote-meta">
                  <span class="quote-author">${escapeHtml(item.sender || '匿名')}</span>
                  <span>${escapeHtml(item.time || '')}</span>
                </div>
                <div class="quote-content">${renderRichTextHtml(item.content || '')}</div>
                ${item.roast ? `
                  <div class="quote-note">
                    <div class="quote-note-label">胡桃锐评</div>
                    ${renderRichTextHtml(item.roast)}
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `
    : ''

  const extraSectionsHtml = extraSections.length > 0
    ? `
      <div class="section source-section">
        <div class="section-title">补充观察</div>
        <div class="supplement-list">
          ${extraSections.map(item => `
            <div class="supplement-card">
              <div class="supplement-card-title">${escapeHtml(item.title || '补充信息')}</div>
              ${renderRichTextHtml(item.content || '')}
            </div>
          `).join('')}
        </div>
      </div>
    `
    : ''
  const userPortraitsHtml = renderUserPortraits(userPortraits)
  const billingHtml = renderBillingSection(billingText)

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getJournalCSS()}</style></head>
    <body><div class="journal journal-group">
      ${renderJournalHeader(displayTitle, '')}
      <div class="journal-body">
        ${statsHtml}
        ${rankChartHtml}
        ${activityChartHtml}
        ${topicHtml}
        ${highlightsHtml}
        ${userPortraitsHtml}
        ${extraSectionsHtml}
        ${billingHtml}
      </div>
      <div class="journal-footer"><span>${escapeHtml(getFooterText())}</span></div>
    </div></body></html>`
}

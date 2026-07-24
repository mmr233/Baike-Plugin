import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginRoot } from '../constant.js'

class IdentityService {
  constructor(options = {}) {
    this.providerPromise = null
    this.yunzaiRoot = options.yunzaiRoot || process.cwd()
    this.masterConfigCache = null
  }

  cleanYamlScalar(value = '') {
    return String(value || '')
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim()
  }

  extractYamlList(text = '', key = '') {
    const lines = String(text || '').replace(/\r/g, '').split('\n')
    const values = []
    const keyPattern = new RegExp(`^${key}\\s*:\\s*(.*)$`)

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^\s/.test(line)) continue
      const match = line.match(keyPattern)
      if (!match) continue

      const inline = this.cleanYamlScalar(match[1])
      if (inline) {
        const content = inline.startsWith('[') && inline.endsWith(']')
          ? inline.slice(1, -1)
          : inline
        for (const item of content.split(',')) {
          const value = this.cleanYamlScalar(item)
          if (value) values.push(value)
        }
      }

      for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
        const childLine = lines[childIndex]
        if (childLine && !/^\s/.test(childLine)) break
        const childMatch = childLine.match(/^\s*-\s*(.+)$/)
        if (childMatch) {
          const value = this.cleanYamlScalar(childMatch[1])
          if (value) values.push(value)
        }
      }
      break
    }

    return values
  }

  readMasterConfigText() {
    const configPath = path.join(this.yunzaiRoot, 'config', 'config', 'other.yaml')
    try {
      const stat = fs.statSync(configPath)
      if (this.masterConfigCache?.mtimeMs === stat.mtimeMs) {
        return this.masterConfigCache.text
      }
      const text = fs.readFileSync(configPath, 'utf8')
      this.masterConfigCache = { mtimeMs: stat.mtimeMs, text }
      return text
    } catch {
      this.masterConfigCache = null
      return ''
    }
  }

  getMasterUserIds(context = {}) {
    const text = this.readMasterConfigText()
    if (!text) return new Set()

    const event = context.event || context.e || {}
    const botId = String(event.self_id || event?.bot?.self_id || '').trim()
    const masterUserIds = new Set()
    for (const value of this.extractYamlList(text, 'masterQQ')) {
      if (/^\d{5,20}$/.test(value)) masterUserIds.add(value)
    }
    if (/^\d{5,20}$/.test(botId)) {
      for (const value of this.extractYamlList(text, 'master')) {
        const separatorIndex = value.indexOf(':')
        if (separatorIndex <= 0) continue
        const targetBotId = value.slice(0, separatorIndex).trim()
        const ownerUserId = value.slice(separatorIndex + 1).trim()
        if (targetBotId === botId && /^\d{5,20}$/.test(ownerUserId)) {
          masterUserIds.add(ownerUserId)
        }
      }
    }
    return masterUserIds
  }

  async loadProvider() {
    if (!this.providerPromise) {
      this.providerPromise = (async () => {
        const providerPath = path.join(pluginRoot, '..', 'Iris-Sign-Plugin', 'model', 'identity.js')
        if (!fs.existsSync(providerPath)) {
          return null
        }
        try {
          const module = await import(pathToFileURL(providerPath).href)
          return module?.default || module?.Identity || null
        } catch (error) {
          logger?.warn?.(`[Baike-Plugin] 加载 Iris 赞助身份服务失败：${error.message}`)
          return null
        }
      })()
    }
    return this.providerPromise
  }

  async getUserIdentities(userIds = [], context = {}) {
    const actualUserIds = [...new Set((userIds || []).map(value => String(value || '').trim()).filter(Boolean))]
    if (actualUserIds.length === 0) {
      return {}
    }

    const masterUserIds = this.getMasterUserIds(context)
    let sponsorIdentities = {}
    try {
      const provider = await this.loadProvider()
      if (provider?.getUserIdentities) {
        sponsorIdentities = provider.getUserIdentities(actualUserIds, context) || {}
      }
    } catch (error) {
      logger?.warn?.(`[Baike-Plugin] 获取 Iris 赞助身份失败：${error.message}`)
    }

    const result = {}
    for (const userId of actualUserIds) {
      const sponsorIdentity = sponsorIdentities[userId] || {}
      const isMaster = masterUserIds.has(userId)
      const sponsorAmount = Math.max(0, Number(sponsorIdentity.sponsorAmount) || 0)
      const isSponsor = sponsorIdentity.isSponsor === true || sponsorAmount > 0
      result[userId] = {
        userId,
        isMaster,
        isSponsor,
        sponsorAmount,
        labels: [isMaster ? 'Bot主人' : '', isSponsor ? '赞助用户' : ''].filter(Boolean)
      }
    }
    return result
  }
}

export default IdentityService

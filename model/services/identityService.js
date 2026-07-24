import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginRoot } from '../constant.js'

class IdentityService {
  constructor() {
    this.providerPromise = null
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
          logger?.warn?.(`[Baike-Plugin] 加载 Iris 身份服务失败：${error.message}`)
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

    const provider = await this.loadProvider()
    if (!provider?.getUserIdentities) {
      return {}
    }

    try {
      return provider.getUserIdentities(actualUserIds, context) || {}
    } catch (error) {
      logger?.warn?.(`[Baike-Plugin] 获取 Iris 用户身份失败：${error.message}`)
      return {}
    }
  }
}

export default IdentityService

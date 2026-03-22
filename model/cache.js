class ResultCache {
  constructor() {
    this.cache = new Map()
  }

  get(key, config = {}) {
    const { enabled = true, ttl = 10 } = config
    if (!enabled || ttl <= 0) {
      return null
    }

    const cached = this.cache.get(key)
    if (!cached) {
      return null
    }

    const expiresAt = cached.timestamp + ttl * 60 * 1000
    if (Date.now() > expiresAt) {
      this.cache.delete(key)
      return null
    }

    return cached
  }

  set(key, data, config = {}) {
    const { enabled = true, ttl = 10, maxSize = 100 } = config
    if (!enabled || ttl <= 0) {
      return
    }

    if (!this.cache.has(key) && this.cache.size >= maxSize) {
      const ttlMs = ttl * 60 * 1000
      for (const [cacheKey, value] of this.cache.entries()) {
        if (Date.now() > value.timestamp + ttlMs) {
          this.cache.delete(cacheKey)
        }
      }

      if (this.cache.size >= maxSize) {
        let oldestKey = null
        let oldestTimestamp = Number.MAX_SAFE_INTEGER

        for (const [cacheKey, value] of this.cache.entries()) {
          if (value.timestamp < oldestTimestamp) {
            oldestTimestamp = value.timestamp
            oldestKey = cacheKey
          }
        }

        if (oldestKey) {
          this.cache.delete(oldestKey)
        }
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }
}

export default new ResultCache()

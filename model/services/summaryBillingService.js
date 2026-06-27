import fs from 'node:fs'
import path from 'node:path'
import Config from '../Config.js'
import { debugLog } from '../debug.js'
import { pluginName, pluginRoot } from '../constant.js'

const IRIS_SHOP_MODULE_PATH = '../../../Iris-Sign-Plugin/model/index.js'
const BILLING_PLUGIN_ID = 'baike'
const BILLING_TYPE = 'baike:summary_service'
const USAGE_DATA_PATH = path.join(pluginRoot, 'data', 'summary_billing_usage.json')
const HOUR_MS = 60 * 60 * 1000

let shopModulePromise = null

function getBoolean(value, fallback) {
  return value === undefined ? fallback : Boolean(value)
}

function getPositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(0, Math.floor(numeric))
}

function clampPositiveInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function normalizeLimitScope(value) {
  const scope = String(value || '').trim()
  return ['user', 'group', 'groupUser'].includes(scope) ? scope : 'groupUser'
}

function getUserName(e = {}) {
  return String(e.sender?.card || e.sender?.nickname || e.user_id || '').trim()
}

class SummaryBillingService {
  constructor() {
    this.registerPromise = null
    this.registeredItemId = ''
    this.usageLockPromise = Promise.resolve()
  }

  getConfig() {
    const config = Config.get('summaryBilling', {})
    const limit = config.limit || config.usageLimit || {}
    return {
      enabled: getBoolean(config.enabled, true),
      itemId: String(config.itemId || 'baike:summary_service').trim() || 'baike:summary_service',
      itemName: String(config.itemName || '百科总结服务').trim() || '百科总结服务',
      defaultCostFavor: getPositiveInteger(config.defaultCostFavor, 3),
      exemptMaster: getBoolean(config.exemptMaster, true),
      chargeCached: getBoolean(config.chargeCached, false),
      chargeFailed: getBoolean(config.chargeFailed, false),
      allowWhenUnavailable: getBoolean(config.allowWhenUnavailable, false),
      respectIrisBaseEnable: getBoolean(config.respectIrisBaseEnable, true),
      limit: {
        enabled: getBoolean(limit.enabled, true),
        maxUses: getPositiveInteger(limit.maxUses, 20),
        periodHours: clampPositiveInteger(limit.periodHours, 1, 24 * 365, 24),
        scope: normalizeLimitScope(limit.scope),
        countCached: getBoolean(limit.countCached, false),
        countFailed: getBoolean(limit.countFailed, false),
        countMaster: getBoolean(limit.countMaster, false)
      }
    }
  }

  isMaster(e = {}) {
    return e?.isMaster === true || e?.isMaster === 1 || e?.isMaster === 'true'
  }

  shouldSkip(e = {}, context = {}, config = this.getConfig()) {
    if (!config.enabled) {
      return { skip: true, reason: 'disabled' }
    }

    if (context.skipBilling) {
      return { skip: true, reason: 'skipBilling' }
    }

    if (!e?.group_id || !e?.user_id) {
      return { skip: true, reason: 'missingContext' }
    }

    return { skip: false }
  }

  shouldSkipCharge(e = {}, context = {}, config = this.getConfig()) {
    if (context.cacheHit && !config.chargeCached) {
      return { skip: true, reason: 'cacheHit' }
    }

    if (config.exemptMaster && this.isMaster(e)) {
      return { skip: true, reason: 'master' }
    }

    return { skip: false }
  }

  shouldTrackUsage(e = {}, context = {}, config = this.getConfig()) {
    if (!config.limit.enabled || config.limit.maxUses <= 0) {
      return false
    }

    if (!e?.group_id || !e?.user_id) {
      return false
    }

    if (context.cacheHit && !config.limit.countCached) {
      return false
    }

    if (this.isMaster(e) && !config.limit.countMaster) {
      return false
    }

    return true
  }

  getUsageScopeKey(e = {}, scope = 'groupUser') {
    const groupId = String(e.group_id || '')
    const userId = String(e.user_id || '')
    if (scope === 'user') {
      return `user:${userId}`
    }
    if (scope === 'group') {
      return `group:${groupId}`
    }
    return `group:${groupId}:user:${userId}`
  }

  getUsageScopeText(scope = 'groupUser') {
    if (scope === 'user') {
      return '每个用户'
    }
    if (scope === 'group') {
      return '每个群'
    }
    return '每个群内用户'
  }

  getLimitPeriodMs(config = this.getConfig()) {
    return Math.max(1, Number(config.limit.periodHours) || 24) * HOUR_MS
  }

  formatRemainingTime(ms) {
    const totalMinutes = Math.max(1, Math.ceil(Number(ms) / 60000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours <= 0) {
      return `${minutes} 分钟`
    }
    if (minutes <= 0) {
      return `${hours} 小时`
    }
    return `${hours} 小时 ${minutes} 分钟`
  }

  readUsageData() {
    if (!fs.existsSync(USAGE_DATA_PATH)) {
      return { version: 1, records: [] }
    }

    try {
      const data = JSON.parse(fs.readFileSync(USAGE_DATA_PATH, 'utf8'))
      return {
        version: 1,
        records: Array.isArray(data.records) ? data.records : []
      }
    } catch (error) {
      logger.warn(`[${pluginName}] 总结次数记录读取失败，已使用空记录继续：${error.message}`)
      return { version: 1, records: [] }
    }
  }

  writeUsageData(data) {
    fs.mkdirSync(path.dirname(USAGE_DATA_PATH), { recursive: true })
    const payload = `${JSON.stringify({
      version: 1,
      records: Array.isArray(data.records) ? data.records : []
    }, null, 2)}\n`
    const tempPath = `${USAGE_DATA_PATH}.tmp`
    fs.writeFileSync(tempPath, payload, 'utf8')
    fs.renameSync(tempPath, USAGE_DATA_PATH)
  }

  normalizeUsageRecords(records = [], config = this.getConfig(), now = Date.now()) {
    const cutoff = now - this.getLimitPeriodMs(config)
    return records
      .filter(record => record && Number(record.createdAt) >= cutoff)
      .map(record => ({
        ...record,
        createdAt: Number(record.createdAt) || now,
        updatedAt: Number(record.updatedAt) || Number(record.createdAt) || now,
        counted: record.counted !== false
      }))
  }

  isCountedUsageRecord(record = {}) {
    return record.counted !== false && ['pending', 'completed', 'failed'].includes(record.status)
  }

  async withUsageLock(worker) {
    const previous = this.usageLockPromise
    const current = previous.catch(() => {}).then(worker)
    this.usageLockPromise = current

    try {
      return await current
    } finally {
      if (this.usageLockPromise === current) {
        this.usageLockPromise = Promise.resolve()
      }
    }
  }

  buildLimitExceededMessage(e = {}, config = this.getConfig(), usedCount = 0, resetAt = Date.now()) {
    const remaining = this.formatRemainingTime(resetAt - Date.now())
    return [
      `${getUserName(e) || '你的'}总结次数已达上限。`,
      `${this.getUsageScopeText(config.limit.scope)} ${config.limit.periodHours} 小时内最多可使用 ${config.limit.maxUses} 次总结。`,
      `当前已使用：${usedCount}/${config.limit.maxUses} 次，约 ${remaining} 后可再次使用。`
    ].join('\n')
  }

  async reserveUsage(e = {}, context = {}, config = this.getConfig()) {
    if (!this.shouldTrackUsage(e, context, config)) {
      return { ok: true, reservation: null }
    }

    return this.withUsageLock(async () => {
      const now = Date.now()
      const data = this.readUsageData()
      data.records = this.normalizeUsageRecords(data.records, config, now)

      const scopeKey = this.getUsageScopeKey(e, config.limit.scope)
      const cutoff = now - this.getLimitPeriodMs(config)
      const activeRecords = data.records
        .filter(record => record.scopeKey === scopeKey && Number(record.createdAt) >= cutoff)
        .filter(record => this.isCountedUsageRecord(record))
      const usedCount = activeRecords.length

      if (usedCount >= config.limit.maxUses) {
        const oldest = activeRecords
          .slice()
          .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))[0]
        const resetAt = Number(oldest?.createdAt || now) + this.getLimitPeriodMs(config)
        this.writeUsageData(data)
        return {
          ok: false,
          code: 'summary_usage_limit_exceeded',
          message: this.buildLimitExceededMessage(e, config, usedCount, resetAt),
          usedCount,
          maxUses: config.limit.maxUses,
          resetAt
        }
      }

      const reservation = {
        id: `${now}_${Math.random().toString(36).slice(2, 10)}`,
        scope: config.limit.scope,
        scopeKey,
        groupId: String(e.group_id || ''),
        userId: String(e.user_id || ''),
        feature: context.feature || 'summary',
        cacheHit: Boolean(context.cacheHit),
        master: this.isMaster(e),
        status: 'pending',
        counted: true,
        createdAt: now,
        updatedAt: now,
        messageId: e.message_id || ''
      }

      data.records.push(reservation)
      this.writeUsageData(data)

      debugLog('summary.billing.usage', '总结次数额度已预占', {
        userId: e.user_id,
        groupId: e.group_id,
        feature: context.feature || 'summary',
        scope: config.limit.scope,
        usedCount: usedCount + 1,
        maxUses: config.limit.maxUses
      })

      return {
        ok: true,
        reservation
      }
    })
  }

  async finalizeUsageReservation(reservation, options = {}) {
    if (!reservation?.id) {
      return null
    }

    return this.withUsageLock(async () => {
      const now = Date.now()
      const config = this.getConfig()
      const data = this.readUsageData()
      data.records = this.normalizeUsageRecords(data.records, config, now)
      const index = data.records.findIndex(record => record.id === reservation.id)
      if (index === -1) {
        return null
      }

      const status = options.status || 'completed'
      const counted = options.counted !== undefined ? Boolean(options.counted) : status !== 'cancelled'
      data.records[index] = {
        ...data.records[index],
        status,
        counted,
        reason: options.reason || data.records[index].reason || '',
        updatedAt: now
      }
      this.writeUsageData(data)

      debugLog('summary.billing.usage', '总结次数记录已更新', {
        id: reservation.id,
        status,
        counted,
        reason: options.reason || ''
      })

      return data.records[index]
    })
  }

  async cancelUsageReservation(reservation, reason = 'cancelled') {
    return this.finalizeUsageReservation(reservation, {
      status: 'cancelled',
      counted: false,
      reason
    })
  }

  async complete(chargeResult, reason = 'summary_completed') {
    if (!chargeResult?.usageReservation || chargeResult.usageFinalized) {
      return null
    }

    const result = await this.finalizeUsageReservation(chargeResult.usageReservation, {
      status: 'completed',
      counted: true,
      reason
    })
    chargeResult.usageFinalized = true
    return result
  }

  async markFailedUsage(chargeResult, reason = 'summary_failed') {
    if (!chargeResult?.usageReservation || chargeResult.usageFinalized) {
      return null
    }

    const countFailed = this.getConfig().limit.countFailed
    const result = await this.finalizeUsageReservation(chargeResult.usageReservation, {
      status: 'failed',
      counted: countFailed,
      reason
    })
    chargeResult.usageFinalized = true
    return result
  }

  async attachUsageResult(result, usageReservation = null, cancelReason = '') {
    if (!result?.ok && usageReservation) {
      await this.cancelUsageReservation(usageReservation, cancelReason || result.code || 'charge_rejected')
    }

    if (usageReservation) {
      return {
        ...result,
        usageReservation
      }
    }

    return result
  }

  async loadShop() {
    if (!shopModulePromise) {
      shopModulePromise = import(IRIS_SHOP_MODULE_PATH)
        .then(module => module?.Shop || null)
        .catch(error => {
          shopModulePromise = null
          logger.warn(`[${pluginName}] Iris-Sign-Plugin 商城加载失败：${error.message}`)
          return null
        })
    }

    return shopModulePromise
  }

  buildServiceTypeDefinition() {
    return {
      type: BILLING_TYPE,
      label: '百科总结服务',
      unit: '次',
      subtitle: '使用百科总结时自动扣费',
      intro: '这是 Baike-Plugin 的服务型商品，触发总结并实际消耗模型时会自动扣除好感度。',
      isEnabled: () => true,
      getOwnedText: async () => '服务型商品，使用总结时自动扣除',
      grant: async ({ item }) => ({
        ok: false,
        code: 'manual_exchange_disabled',
        message: `${item?.name || '百科总结服务'}会在使用总结时自动扣除，无需手动兑换`
      })
    }
  }

  async ensureRegistered() {
    const config = this.getConfig()
    if (!config.enabled) {
      return { ok: false, code: 'disabled', message: '总结计费未启用' }
    }

    if (this.registeredItemId && this.registeredItemId !== config.itemId) {
      this.registerPromise = null
      this.registeredItemId = ''
    }

    if (!this.registerPromise) {
      this.registerPromise = (async () => {
        const Shop = await this.loadShop()
        if (!Shop) {
          return {
            ok: false,
            code: 'shop_unavailable',
            message: '签到商城暂不可用，请稍后再试'
          }
        }

        const typeRegistered = Shop.registerType(this.buildServiceTypeDefinition(), {}, {
          override: true,
          pluginId: BILLING_PLUGIN_ID,
          source: pluginName
        })
        if (!typeRegistered?.ok && !['type_exists', 'type_overridden'].includes(typeRegistered?.code)) {
          return {
            ok: false,
            code: typeRegistered?.code || 'type_register_failed',
            message: typeRegistered?.message || '总结计费商品类型注册失败'
          }
        }

        const configItem = (Shop.getConfigItems?.() || []).find(item => item.id === config.itemId)
        if (configItem) {
          Shop.unregisterItem?.(config.itemId)
          return {
            ok: true,
            Shop,
            item: configItem
          }
        }

        let item = Shop.getItemById?.(config.itemId)
        if (!item) {
          const registered = Shop.registerItem({
            id: config.itemId,
            name: config.itemName,
            type: BILLING_TYPE,
            costFavor: config.defaultCostFavor,
            amount: 1,
            limitDays: 0,
            limitCount: 0,
            desc: 'Baike-Plugin 总结功能自动扣费项；可在 Iris-Sign-Plugin 的商城配置中用同 ID 覆盖价格。',
            enabled: true,
            sellable: true,
            rewardable: false,
            pluginId: BILLING_PLUGIN_ID,
            source: pluginName
          }, {
            pluginId: BILLING_PLUGIN_ID,
            source: pluginName
          })

          if (!registered?.ok && registered?.code !== 'item_exists') {
            return {
              ok: false,
              code: registered.code || 'item_register_failed',
              message: registered.message || '总结计费商品注册失败'
            }
          }

          item = registered.item || Shop.getItemById?.(config.itemId)
        }

        return {
          ok: true,
          Shop,
          item
        }
      })()
    }

    const result = await this.registerPromise
    if (!result?.ok) {
      this.registerPromise = null
      this.registeredItemId = ''
    } else {
      this.registeredItemId = config.itemId
    }
    return result
  }

  buildUnavailableResult(message, code = 'shop_unavailable') {
    const config = this.getConfig()
    if (config.allowWhenUnavailable) {
      return {
        ok: true,
        charged: false,
        skipped: true,
        reason: code
      }
    }

    return {
      ok: false,
      code,
      message
    }
  }

  resolveBillingItem(Shop, itemId) {
    const key = String(itemId || '').trim()
    const configItem = (Shop.getConfigItems?.() || []).find(item => item.id === key)
    if (configItem) {
      Shop.unregisterItem?.(key)
    }
    return configItem || Shop.getItemById?.(key) || null
  }

  async charge(e = {}, context = {}) {
    const config = this.getConfig()
    const skipped = this.shouldSkip(e, context, config)
    if (skipped.skip) {
      return {
        ok: true,
        charged: false,
        skipped: true,
        reason: skipped.reason
      }
    }

    const usageResult = await this.reserveUsage(e, context, config)
    if (!usageResult.ok) {
      return usageResult
    }
    const usageReservation = usageResult.reservation

    const chargeSkipped = this.shouldSkipCharge(e, context, config)
    if (chargeSkipped.skip) {
      return {
        ok: true,
        charged: false,
        skipped: true,
        reason: chargeSkipped.reason,
        usageReservation
      }
    }

    const registered = await this.ensureRegistered()
    if (!registered.ok) {
      return this.attachUsageResult(
        this.buildUnavailableResult(registered.message || '签到商城暂不可用，请稍后再试', registered.code),
        usageReservation,
        registered.code
      )
    }

    const { Shop } = registered
    const item = this.resolveBillingItem(Shop, config.itemId) || registered.item
    if (!item) {
      return this.attachUsageResult(
        this.buildUnavailableResult('未找到总结计费商品，请联系主人检查 Iris 商城配置', 'item_not_found'),
        usageReservation,
        'item_not_found'
      )
    }

    if (config.respectIrisBaseEnable && Shop.isPlatformEnabled?.() === false) {
      return this.attachUsageResult(
        this.buildUnavailableResult('签到插件当前已关闭，暂时无法使用总结计费服务', 'platform_disabled'),
        usageReservation,
        'platform_disabled'
      )
    }

    if (Shop.isItemEnabled?.(item) === false) {
      return this.attachUsageResult(
        this.buildUnavailableResult(`${item.name} 暂未开放使用`, 'item_disabled'),
        usageReservation,
        'item_disabled'
      )
    }

    const costFavor = Math.max(0, Number(item.costFavor) || 0)
    if (costFavor <= 0) {
      return {
        ok: true,
        charged: false,
        skipped: true,
        reason: 'free',
        item,
        costFavor,
        usageReservation
      }
    }

    const favorResult = Shop.getFavor({
      groupId: e.group_id,
      userId: e.user_id
    })
    if (!favorResult.ok) {
      return this.attachUsageResult(
        this.buildUnavailableResult(favorResult.message || '无法读取好感度，请稍后再试', favorResult.code),
        usageReservation,
        favorResult.code
      )
    }

    if (favorResult.favor < costFavor) {
      return this.attachUsageResult({
        ok: false,
        code: 'favor_insufficient',
        message: [
          `${getUserName(e) || '你的'}好感度不足，本次${item.name}需要 ${costFavor} 点好感度。`,
          `当前好感度：${favorResult.favor} 点。可通过签到获取好感度后再试。`
        ].join('\n'),
        item,
        favor: favorResult.favor,
        costFavor
      }, usageReservation, 'favor_insufficient')
    }

    const transactionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const chargeSource = `${pluginName}:summary:${transactionId}`
    const chargeOptions = {
      groupId: e.group_id,
      userId: e.user_id,
      item,
      itemId: item.id,
      count: 1,
      source: chargeSource,
      respectBaseEnable: config.respectIrisBaseEnable,
      meta: {
        transactionId,
        feature: context.feature || 'summary',
        cacheHit: Boolean(context.cacheHit),
        messageId: e.message_id || '',
        groupId: e.group_id,
        userId: e.user_id
      }
    }
    const result = typeof Shop.chargeService === 'function'
      ? await Shop.chargeService(chargeOptions)
      : await Shop.addFavor({
        groupId: e.group_id,
        userId: e.user_id,
        value: -costFavor,
        source: chargeSource,
        meta: {
          itemId: item.id,
          itemName: item.name,
          transactionId,
          feature: context.feature || 'summary',
          cacheHit: Boolean(context.cacheHit),
          messageId: e.message_id || '',
          groupId: e.group_id,
          userId: e.user_id
        }
      })

    if (!result.ok) {
      return this.attachUsageResult({
        ok: false,
        code: result.code || 'charge_failed',
        message: result.message || `${item.name}扣费失败，请稍后再试`,
        item,
        favor: result.favor,
        costFavor
      }, usageReservation, result.code || 'charge_failed')
    }

    if (result.deltaFavor !== undefined && result.deltaFavor !== -costFavor) {
      const deducted = Math.abs(Number(result.deltaFavor) || 0)
      if (deducted > 0) {
        await Shop.addFavor({
          groupId: e.group_id,
          userId: e.user_id,
          value: deducted,
          source: `${pluginName}:summary-partial-refund`,
          meta: {
            itemId: item.id,
            reason: 'favor_race_insufficient'
          }
        })
      }

      return this.attachUsageResult({
        ok: false,
        code: 'favor_insufficient',
        message: [
          `${getUserName(e) || '你的'}好感度不足，本次${item.name}需要 ${costFavor} 点好感度。`,
          `当前好感度：${result.beforeFavor} 点。可通过签到获取好感度后再试。`
        ].join('\n'),
        item,
        favor: result.beforeFavor,
        costFavor
      }, usageReservation, 'favor_race_insufficient')
    }

    debugLog('summary.billing', '总结计费扣除完成', {
      userId: e.user_id,
      groupId: e.group_id,
      itemId: item.id,
      costFavor,
      beforeFavor: result.beforeFavor,
      favor: result.favor,
      feature: context.feature || 'summary'
    })

    return {
      ok: true,
      charged: true,
      item,
      costFavor,
      beforeFavor: result.beforeFavor,
      favor: result.favor,
      groupId: e.group_id,
      userId: e.user_id,
      transactionId,
      source: result.source || chargeSource,
      usageReservation,
      refunded: false
    }
  }

  async refund(chargeResult, reason = 'summary_failed') {
    await this.markFailedUsage(chargeResult, reason)

    if (!chargeResult?.charged || chargeResult.refunded || this.getConfig().chargeFailed) {
      return null
    }

    const Shop = await this.loadShop()
    if (!Shop) {
      logger.warn(`[${pluginName}] 总结失败后退款失败：Iris 商城不可用`)
      return null
    }

    const result = typeof Shop.refundServiceCharge === 'function'
      ? await Shop.refundServiceCharge({
        groupId: chargeResult.groupId,
        userId: chargeResult.userId,
        itemId: chargeResult.item?.id || '',
        transactionId: chargeResult.transactionId,
        costFavor: chargeResult.costFavor,
        source: chargeResult.source || `${pluginName}:summary`,
        refundSource: `${pluginName}:summary-refund`,
        meta: {
          reason
        }
      })
      : await Shop.addFavor({
        groupId: chargeResult.groupId,
        userId: chargeResult.userId,
        value: chargeResult.costFavor,
        source: `${pluginName}:summary-refund`,
        meta: {
          reason,
          itemId: chargeResult.item?.id || '',
          transactionId: chargeResult.transactionId || ''
        }
      })
    if (result.ok) {
      chargeResult.refunded = true
      logger.info(`[${pluginName}] 总结未完成，已退回 ${chargeResult.costFavor} 点好感度`)
    } else {
      logger.warn(`[${pluginName}] 总结失败后退款失败：${result.message || result.code || '未知错误'}`)
    }

    return result
  }
}

export default SummaryBillingService

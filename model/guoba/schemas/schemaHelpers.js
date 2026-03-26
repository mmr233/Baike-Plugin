function normalizeText(value = '') {
  return String(value || '').trim()
}

function findOptionLabel(options = [], value) {
  for (const option of options) {
    if (!option || typeof option !== 'object') {
      continue
    }

    if (Array.isArray(option.options)) {
      const nestedLabel = findOptionLabel(option.options, value)
      if (nestedLabel) {
        return nestedLabel
      }
    }

    if (String(option.value) === String(value)) {
      return option.label || String(option.value)
    }
  }

  return ''
}

function formatRecommendedValue(value, schema = {}) {
  if (schema?.componentProps?.disabled) {
    return '只读展示'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '留空'
    }

    const options = Array.isArray(schema?.componentProps?.options) ? schema.componentProps.options : []
    return value.map(item => findOptionLabel(options, item) || String(item)).join('、')
  }

  if (typeof value === 'boolean') {
    return value ? '开启' : '关闭'
  }

  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (schema?.component === 'Select' || schema?.component === 'RadioGroup') {
    const options = Array.isArray(schema?.componentProps?.options) ? schema.componentProps.options : []
    return findOptionLabel(options, value) || String(value)
  }

  return String(value)
}

function deriveRecommendedValue(schema = {}, recommendationMap = {}) {
  if (!schema?.field) {
    return ''
  }

  if (schema.componentProps?.disabled) {
    return '只读展示'
  }

  if (recommendationMap[schema.field] !== undefined) {
    return formatRecommendedValue(recommendationMap[schema.field], schema)
  }

  if (schema.recommendedValue !== undefined) {
    return formatRecommendedValue(schema.recommendedValue, schema)
  }

  if (schema.defaultValue !== undefined) {
    return formatRecommendedValue(schema.defaultValue, schema)
  }

  const placeholder = normalizeText(schema?.componentProps?.placeholder)
  if (placeholder) {
    if (placeholder === '可多选') {
      return '按需多选'
    }

    if (placeholder.startsWith('点击选择')) {
      return '按需选择'
    }

    if (placeholder === '留空使用默认') {
      return '留空使用默认'
    }

    const exampleMatch = placeholder.match(/^例如[:：]?\s*(.+)$/)
    if (exampleMatch?.[1]) {
      return normalizeText(exampleMatch[1])
    }
  }

  if (schema.component === 'Switch') {
    return '按需开关'
  }

  if (schema.component === 'InputPassword') {
    return '按需填写'
  }

  if (schema.component === 'GSelectGroup' || schema.component === 'GSelectFriend') {
    return '按需选择'
  }

  if (schema.component === 'InputTextArea') {
    return '保持默认模板'
  }

  if (['Input', 'InputNumber', 'Select', 'RadioGroup'].includes(schema.component)) {
    return '按需配置'
  }

  return ''
}

function buildDescription(schema = {}) {
  const label = normalizeText(schema.label || schema.field || '')
  if (!label) {
    return ''
  }

  if (schema.component === 'Switch' || /启用|开启|开关|调试/.test(label)) {
    return `用于控制「${label}」是否开启。`
  }

  if (schema.component === 'InputPassword') {
    return `用于填写「${label}」，请妥善保管敏感信息。`
  }

  if (schema.component === 'InputNumber') {
    return `用于设置「${label}」的数值。`
  }

  if (schema.component === 'Select' || schema.component === 'RadioGroup') {
    return `用于选择「${label}」的可选项。`
  }

  if (schema.component === 'InputTextArea') {
    return `用于编辑「${label}」文本内容。`
  }

  if (schema.component === 'GSelectGroup' || schema.component === 'GSelectFriend') {
    return `用于选择「${label}」目标。`
  }

  return `用于配置「${label}」。`
}

function appendRecommendedHelpMessage(helpText = '', recommendedValue = '') {
  const help = normalizeText(helpText)
  const recommended = normalizeText(recommendedValue)
  if (!recommended) {
    return help
  }

  if (help.includes('推荐值：')) {
    return help
  }

  return help ? `${help}\n推荐值：${recommended}` : `推荐值：${recommended}`
}

function enhanceFieldHelp(schema = {}, recommendationMap = {}) {
  if (!schema?.field) {
    return schema
  }

  const description = normalizeText(schema.bottomHelpMessage) || buildDescription(schema)
  const recommended = deriveRecommendedValue(schema, recommendationMap)
  const bottomHelpMessage = appendRecommendedHelpMessage(description, recommended)

  return {
    ...schema,
    bottomHelpMessage
  }
}

export function enhanceSchemas(items = [], options = {}) {
  const recommendationMap = options.recommendationMap || {}

  return items.map(item => {
    if (!item || typeof item !== 'object') {
      return item
    }

    let next = { ...item }
    if (next.componentProps && Array.isArray(next.componentProps.schemas)) {
      next = {
        ...next,
        componentProps: {
          ...next.componentProps,
          schemas: enhanceSchemas(next.componentProps.schemas, options)
        }
      }
    }

    return enhanceFieldHelp(next, recommendationMap)
  })
}

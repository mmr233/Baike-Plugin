import fs from 'node:fs'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { beautifyText } from '../../utils/text.js'

function parseJson(text, context = '接口响应') {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${context} 不是合法 JSON：${text.slice(0, 200)}`)
  }
}

class ApiService {
  getModelConfig(modelType) {
    const apiConfig = Config.get('api', {})
    const modelConfig = apiConfig?.[modelType] || {}

    return {
      baseUrl: (modelConfig.baseUrl || apiConfig.primaryBaseUrl || '').replace(/\/$/, ''),
      apiKey: modelConfig.apiKey || apiConfig.primaryApiKey || '',
      model: modelConfig.model || ''
    }
  }

  async requestChatCompletion(modelType, messages, options = {}) {
    const {
      baseUrl,
      apiKey,
      model
    } = this.getModelConfig(modelType)

    if (!baseUrl || !apiKey || !model) {
      throw new Error(`${modelType} 模型配置不完整，请检查锅巴面板或配置文件`)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 120000)

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          group: 'default',
          messages,
          stream: false,
          temperature: options.temperature ?? 0.3,
          top_p: options.topP ?? 1,
          frequency_penalty: options.frequencyPenalty ?? 0,
          presence_penalty: options.presencePenalty ?? 0
        }),
        signal: controller.signal
      })

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      }

      return {
        text,
        json: parseJson(text, `${modelType} 响应`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async callAudioAPI(audioPath) {
    if (!audioPath || !fs.existsSync(audioPath)) {
      return null
    }

    const base64 = fs.readFileSync(audioPath).toString('base64')
    const { json } = await this.requestChatCompletion('audio', [
      {
        role: 'user',
        content: [
          { type: 'text', text: '请将这段语音转录为文字，直接输出内容，不要包含任何其他描述。' },
          { type: 'input_audio', input_audio: { data: base64, format: 'mp3' } }
        ]
      }
    ], {
      timeout: 60000
    })

    return json?.choices?.[0]?.message?.content || null
  }

  async callTextImageAPI(content, imageFiles = []) {
    const promptConfig = Config.get('prompt', {})
    const userContent = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    let imageCount = 0
    for (const media of imageFiles) {
      if (media.type !== 'image' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      const base64 = fs.readFileSync(media.localPath).toString('base64')
      const mimeType = media.localPath.endsWith('.png') ? 'image/png' : 'image/jpeg'
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      })
      imageCount += 1
    }

    if (userContent.length === 0) {
      return null
    }

    let systemPrompt = promptConfig.summaryDefault || ''
    if (imageCount > 0) {
      systemPrompt += (promptConfig.summaryImageAppend || '').replace('{count}', imageCount)
    }

    const { json } = await this.requestChatCompletion('summary', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ], {
      timeout: 120000
    })

    const result = json?.choices?.[0]?.message?.content || null
    return result ? beautifyText(result) : null
  }

  async callVideoAPI(content, videoFiles = []) {
    const promptConfig = Config.get('prompt', {})
    const userContent = []

    if (content) {
      userContent.push({ type: 'text', text: content })
    }

    let videoCount = 0
    for (const media of videoFiles) {
      if (media.type !== 'video' || !media.localPath || !fs.existsSync(media.localPath)) {
        continue
      }

      const base64 = fs.readFileSync(media.localPath).toString('base64')
      userContent.push({
        type: 'video_url',
        video_url: {
          url: `data:video/mp4;base64,${base64}`
        }
      })
      videoCount += 1
    }

    if (videoCount === 0) {
      return null
    }

    const { json } = await this.requestChatCompletion('video', [
      { role: 'system', content: promptConfig.video || '' },
      { role: 'user', content: userContent }
    ], {
      timeout: 180000
    })

    const result = json?.choices?.[0]?.message?.content || null
    return result ? beautifyText(result) : null
  }

  async callSummaryAPI(content, mediaFiles = []) {
    const fileConfig = Config.get('fileRequest', {})
    const imageFiles = mediaFiles.filter(item => item.type === 'image')
    const videoFiles = mediaFiles.filter(item => item.type === 'video')
    const results = []

    if (content || imageFiles.length > 0) {
      const imageLimit = fileConfig.imageMaxPerRequest || 20
      const loopLimit = fileConfig.maxRequestLoops || 1
      const totalBatches = Math.ceil(imageFiles.length / imageLimit) || 1
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = imageFiles.slice(batch * imageLimit, (batch + 1) * imageLimit)
        const prompt = batch === 0 ? content : `继续分析第${batch + 1}批图片内容`
        const result = await this.callTextImageAPI(prompt, chunk)
        if (result) {
          results.push(actualBatches > 1 ? `【第${batch + 1}批图片分析】\n${result}` : result)
        }
      }
    }

    if (videoFiles.length > 0) {
      const videoLimit = fileConfig.videoMaxPerRequest || 3
      const loopLimit = fileConfig.maxRequestLoops || 1
      const totalBatches = Math.ceil(videoFiles.length / videoLimit)
      const actualBatches = Math.min(totalBatches, loopLimit)

      for (let batch = 0; batch < actualBatches; batch += 1) {
        const chunk = videoFiles.slice(batch * videoLimit, (batch + 1) * videoLimit)
        const prompt = batch === 0
          ? (content ? `请结合以下背景信息分析视频：${content}` : '请分析这个视频的内容')
          : `继续分析第${batch + 1}批视频内容`

        const result = await this.callVideoAPI(prompt, chunk)
        if (result) {
          results.push(actualBatches > 1 ? `【第${batch + 1}批视频分析】\n${result}` : result)
        }
      }
    }

    return results.length > 0 ? results.join('\n\n') : null
  }

  async searchKeyword(keyword) {
    const { json } = await this.requestChatCompletion('search', [
      { role: 'user', content: keyword }
    ], {
      timeout: 100000,
      temperature: 0.7
    })

    return {
      content: json?.choices?.[0]?.message?.content || '',
      citations: json?.citations || []
    }
  }

  async organizeSearchResult(keyword, searchContent) {
    const prompt = Config.get('prompt.search', '')
    const { json } = await this.requestChatCompletion('summary', [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `请整理以下关于"${keyword}"的搜索结果：\n\n${searchContent}`
      }
    ], {
      timeout: 100000
    })

    const summaryContent = json?.choices?.[0]?.message?.content || ''
    let jsonString = summaryContent
    const fenced = summaryContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) {
      jsonString = fenced[1].trim()
    }

    try {
      return JSON.parse(jsonString)
    } catch (error) {
      logger.warn(`[${pluginName}] 搜索结果结构化失败，已降级为纯文本：${error.message}`)
      return { 总结: searchContent }
    }
  }
}

export default ApiService

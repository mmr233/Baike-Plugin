import fs from 'node:fs'
import path from 'node:path'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { debugLog } from '../debug.js'

const exec = promisify(execCallback)
const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const JPEG_SOF_MARKERS = new Set([
  0xC0, 0xC1, 0xC2, 0xC3,
  0xC5, 0xC6, 0xC7,
  0xC9, 0xCA, 0xCB,
  0xCD, 0xCE, 0xCF
])

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16)
}

class MediaService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', pluginName)
  }

  ensureTempDir() {
    fs.mkdirSync(this.tempDir, { recursive: true })
  }

  cleanupFile(filePath, delay = 0) {
    if (!filePath) {
      return
    }

    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 清理临时文件失败：${error.message}`)
      }
    }, delay)
  }

  cleanupFiles(files, delay = 0) {
    for (const file of files) {
      const filePath = typeof file === 'string' ? file : file?.localPath
      this.cleanupFile(filePath, delay)
    }
  }

  isGifUrl(url = '') {
    return String(url).toLowerCase().includes('.gif') || String(url).toLowerCase().includes('gif')
  }

  isHttpUrl(url = '') {
    return /^https?:\/\//i.test(String(url || '').trim())
  }

  isDataUrl(url = '') {
    return /^data:/i.test(String(url || '').trim())
  }

  escapeShellArg(value = '') {
    return String(value).replace(/"/g, '\\"')
  }

  normalizeLocalPath(source = '') {
    const value = String(source || '').trim()
    if (!value) {
      return ''
    }

    if (/^file:\/\//i.test(value)) {
      try {
        return fileURLToPath(value)
      } catch {
        return value.replace(/^file:\/+/, '')
      }
    }

    return value
  }

  looksLikeGif(buffer) {
    return Buffer.isBuffer(buffer)
      && buffer.length > 3
      && buffer[0] === 0x47
      && buffer[1] === 0x49
      && buffer[2] === 0x46
  }

  getImageMimeType(filePath = '') {
    const normalized = String(filePath || '').toLowerCase()
    if (normalized.endsWith('.png')) {
      return 'image/png'
    }
    if (normalized.endsWith('.gif')) {
      return 'image/gif'
    }
    if (normalized.endsWith('.webp')) {
      return 'image/webp'
    }
    if (normalized.endsWith('.bmp')) {
      return 'image/bmp'
    }
    return 'image/jpeg'
  }

  getOutputImageFormat(filePath = '') {
    const mimeType = this.getImageMimeType(filePath)
    if (['image/png', 'image/webp', 'image/bmp'].includes(mimeType)) {
      return { type: 'png', ext: '.png' }
    }

    return { type: 'jpeg', ext: '.jpg' }
  }

  getLongImageSplitConfig() {
    const config = Config.get('fileRequest.longImageAutoSplit', {})
    const triggerHeight = clampNumber(config?.triggerHeight, 1200, 24000, 3200)
    const chunkHeight = clampNumber(
      config?.chunkHeight,
      800,
      triggerHeight,
      Math.min(2800, triggerHeight)
    )
    const overlap = clampNumber(
      config?.overlap,
      0,
      Math.max(0, Math.floor(chunkHeight / 3)),
      96
    )
    const maxSegments = clampNumber(config?.maxSegments, 1, 12, 8)

    return {
      enabled: config?.enabled !== false,
      triggerHeight,
      chunkHeight,
      overlap,
      maxSegments,
      analysisWidth: 480,
      searchWindow: 180
    }
  }

  getImageDimensionsFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 10) {
      return null
    }

    if (
      buffer.length >= 24
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4E
      && buffer[3] === 0x47
    ) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        format: 'png'
      }
    }

    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xFF) {
          offset += 1
          continue
        }

        const marker = buffer[offset + 1]
        if (marker === 0xD8 || marker === 0x01) {
          offset += 2
          continue
        }

        if (marker === 0xD9 || marker === 0xDA) {
          break
        }

        if (offset + 4 > buffer.length) {
          break
        }

        const length = buffer.readUInt16BE(offset + 2)
        if (length < 2) {
          break
        }

        if (JPEG_SOF_MARKERS.has(marker) && offset + 9 < buffer.length) {
          return {
            width: buffer.readUInt16BE(offset + 7),
            height: buffer.readUInt16BE(offset + 5),
            format: 'jpeg'
          }
        }

        offset += 2 + length
      }
    }

    if (
      buffer.length >= 10
      && buffer.toString('ascii', 0, 3) === 'GIF'
    ) {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
        format: 'gif'
      }
    }

    if (
      buffer.length >= 26
      && buffer.toString('ascii', 0, 2) === 'BM'
    ) {
      return {
        width: Math.abs(buffer.readInt32LE(18)),
        height: Math.abs(buffer.readInt32LE(22)),
        format: 'bmp'
      }
    }

    if (
      buffer.length >= 30
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      const chunkType = buffer.toString('ascii', 12, 16)

      if (chunkType === 'VP8X' && buffer.length >= 30) {
        return {
          width: readUInt24LE(buffer, 24) + 1,
          height: readUInt24LE(buffer, 27) + 1,
          format: 'webp'
        }
      }

      if (chunkType === 'VP8L' && buffer.length >= 25) {
        const b1 = buffer[21]
        const b2 = buffer[22]
        const b3 = buffer[23]
        const b4 = buffer[24]
        return {
          width: 1 + (((b2 & 0x3F) << 8) | b1),
          height: 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6)),
          format: 'webp'
        }
      }
    }

    return null
  }

  getImageDimensions(localPath = '') {
    if (!localPath || !fs.existsSync(localPath)) {
      return null
    }

    try {
      const buffer = fs.readFileSync(localPath)
      return this.getImageDimensionsFromBuffer(buffer)
    } catch (error) {
      logger.warn(`[${pluginName}] 读取图片尺寸失败：${error.message}`)
      return null
    }
  }

  async launchBrowser() {
    return puppeteer.launch({
      headless: 'new',
      args: PUPPETEER_ARGS
    })
  }

  async convertGifToStaticImage(gifPath) {
    const targetPath = `${gifPath.replace(/\.[^.]+$/, '')}_static.png`

    try {
      await exec(`ffmpeg -i "${this.escapeShellArg(gifPath)}" -frames:v 1 -update 1 -y "${this.escapeShellArg(targetPath)}"`, {
        timeout: 60000
      })

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
        return targetPath
      }
    } catch (error) {
      logger.warn(`[${pluginName}] GIF 静态化失败：${error.message}`)
    }

    this.cleanupFile(targetPath)
    return null
  }

  async downloadFile(url, filename, options = {}) {
    if (!url) {
      return null
    }

    this.ensureTempDir()
    const filePath = path.join(this.tempDir, filename)
    const controller = new AbortController()
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      if (this.isDataUrl(url)) {
        const base64 = String(url).split(',')[1] || ''
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
        return filePath
      }

      if (!this.isHttpUrl(url)) {
        const localPath = this.normalizeLocalPath(url)
        if (localPath && fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, filePath)
          return filePath
        }

        return null
      }

      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(filePath, buffer)
      return filePath
    } catch (error) {
      logger.error(`[${pluginName}] 下载文件失败：${error.message}`)
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async splitLongImage(localPath, imageMeta = {}, options = {}) {
    const splitConfig = {
      ...this.getLongImageSplitConfig(),
      ...(options || {})
    }

    if (!splitConfig.enabled || !localPath || !fs.existsSync(localPath)) {
      return [{ ...imageMeta, localPath }]
    }

    const dimensions = this.getImageDimensions(localPath)
    if (!dimensions?.width || !dimensions?.height || dimensions.height <= splitConfig.triggerHeight) {
      return [{ ...imageMeta, localPath }]
    }

    let browser = null
    const segmentPaths = []

    try {
      browser = await this.launchBrowser()
      const workPage = await browser.newPage()
      const sourceDataUrl = `data:${this.getImageMimeType(localPath)};base64,${fs.readFileSync(localPath).toString('base64')}`
      await workPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
      await workPage.setContent(`
        <!DOCTYPE html>
        <html>
          <body style="margin:0;background:#fff;">
            <img id="source" style="display:block;max-width:none;" />
          </body>
        </html>
      `, { waitUntil: 'domcontentloaded' })
      await workPage.$eval('#source', (img, src) => {
        img.src = src
      }, sourceDataUrl)

      const splitPlan = await workPage.evaluate(async splitOptions => {
        const img = document.getElementById('source')

        await new Promise((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve()
            return
          }

          img.onload = () => resolve()
          img.onerror = () => reject(new Error('图片加载失败'))
        })

        const width = img.naturalWidth || img.width || 0
        const height = img.naturalHeight || img.height || 0
        if (!width || !height || height <= splitOptions.triggerHeight) {
          return { width, height, segments: [] }
        }

        const analysisWidth = Math.max(1, Math.min(width, splitOptions.analysisWidth || 480))
        const scale = analysisWidth / width
        const analysisHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = analysisWidth
        canvas.height = analysisHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(img, 0, 0, analysisWidth, analysisHeight)
        const { data } = context.getImageData(0, 0, analysisWidth, analysisHeight)
        const sampleStep = Math.max(1, Math.floor(analysisWidth / 160))
        const scores = new Array(analysisHeight).fill(0)
        let previousRow = null

        for (let y = 0; y < analysisHeight; y += 1) {
          const samples = []
          let horizontalContrast = 0
          let previousLum = null

          for (let x = 0; x < analysisWidth; x += sampleStep) {
            const offset = (y * analysisWidth + x) * 4
            const alpha = data[offset + 3] / 255
            const luminance = alpha === 0
              ? 255
              : ((data[offset] * 299) + (data[offset + 1] * 587) + (data[offset + 2] * 114)) / 1000

            samples.push(luminance)

            if (previousLum !== null) {
              horizontalContrast += Math.abs(luminance - previousLum)
            }
            previousLum = luminance
          }

          let verticalContrast = 0
          if (previousRow) {
            const count = Math.min(samples.length, previousRow.length)
            for (let index = 0; index < count; index += 1) {
              verticalContrast += Math.abs(samples[index] - previousRow[index])
            }
            verticalContrast /= Math.max(count, 1)
          }

          horizontalContrast /= Math.max(samples.length - 1, 1)
          scores[y] = horizontalContrast * 0.65 + verticalContrast * 0.35
          previousRow = samples
        }

        const smoothedScores = scores.map((_, index) => {
          let total = 0
          let count = 0
          for (let offset = -2; offset <= 2; offset += 1) {
            const target = index + offset
            if (target < 0 || target >= scores.length) {
              continue
            }
            total += scores[target]
            count += 1
          }
          return total / Math.max(count, 1)
        })

        const overlap = Math.max(0, Math.round(splitOptions.overlap * scale))
        const minSegment = Math.max(120, Math.round(Math.min(
          splitOptions.chunkHeight * 0.55,
          Math.max(splitOptions.chunkHeight - splitOptions.overlap, splitOptions.chunkHeight * 0.45)
        ) * scale))
        let chunkHeight = Math.max(minSegment + 10, Math.round(splitOptions.chunkHeight * scale))
        const searchWindow = Math.max(8, Math.round((splitOptions.searchWindow || 180) * scale))
        const maxSegments = Math.max(1, splitOptions.maxSegments || 1)
        const visibleHeight = Math.max(1, chunkHeight - overlap)
        const requiredSegments = Math.max(1, Math.ceil((analysisHeight - overlap) / visibleHeight))

        if (requiredSegments > maxSegments) {
          chunkHeight = Math.max(
            minSegment + 10,
            Math.ceil((analysisHeight + overlap * (maxSegments - 1)) / maxSegments)
          )
        }

        const rawSegments = []
        let start = 0
        let guard = 0

        while (
          analysisHeight - start > chunkHeight
          && rawSegments.length < maxSegments - 1
          && guard < maxSegments * 4
        ) {
          guard += 1
          const ideal = start + chunkHeight
          const minCut = Math.max(start + minSegment, ideal - searchWindow)
          const maxCut = Math.min(analysisHeight - minSegment, ideal + searchWindow)
          let bestCut = Math.min(Math.max(ideal, minCut), maxCut)
          let bestScore = Number.POSITIVE_INFINITY

          for (let y = minCut; y <= maxCut; y += 1) {
            const score = smoothedScores[y] + Math.abs(y - ideal) * 0.015
            if (score < bestScore) {
              bestScore = score
              bestCut = y
            }
          }

          const end = Math.max(start + minSegment, bestCut)
          rawSegments.push({ start, end })

          const nextStart = Math.max(0, end - overlap)
          start = nextStart > start ? nextStart : end
        }

        rawSegments.push({ start, end: analysisHeight })

        const mappedSegments = []
        for (const segment of rawSegments) {
          const top = Math.max(0, Math.min(height - 1, Math.round(segment.start / scale)))
          const bottom = Math.max(top + 1, Math.min(height, Math.round(segment.end / scale)))

          if (
            mappedSegments.length > 0
            && top <= mappedSegments[mappedSegments.length - 1].top
            && bottom <= mappedSegments[mappedSegments.length - 1].bottom
          ) {
            continue
          }

          mappedSegments.push({
            top,
            height: bottom - top
          })
        }

        return {
          width,
          height,
          segments: mappedSegments
        }
      }, splitConfig)

      if (!splitPlan?.segments || splitPlan.segments.length <= 1) {
        await workPage.close()
        return [{ ...imageMeta, localPath }]
      }

      const viewportWidth = Math.max(320, Math.min(splitPlan.width || dimensions.width, 4096))
      const viewportHeight = Math.max(400, Math.min(splitConfig.chunkHeight, 2048))
      await workPage.setViewport({
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: 1
      })
      await workPage.evaluate(width => {
        document.documentElement.style.width = `${width}px`
        document.body.style.width = `${width}px`
      }, splitPlan.width)

      const format = this.getOutputImageFormat(localPath)
      const baseName = path.basename(localPath, path.extname(localPath))
      const files = []

      for (let index = 0; index < splitPlan.segments.length; index += 1) {
        const segment = splitPlan.segments[index]
        const segmentPath = path.join(
          this.tempDir,
          `${baseName}_split_${Date.now()}_${index + 1}${format.ext}`
        )

        const screenshotOptions = {
          path: segmentPath,
          type: format.type,
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: segment.top,
            width: splitPlan.width,
            height: segment.height
          }
        }

        if (format.type === 'jpeg') {
          screenshotOptions.quality = 92
        }

        await workPage.screenshot(screenshotOptions)

        segmentPaths.push(segmentPath)
        files.push({
          ...imageMeta,
          type: 'image',
          localPath: segmentPath,
          splitMeta: {
            sourceKey: `${imageMeta.url || localPath}:${splitPlan.height}`,
            partIndex: index + 1,
            totalParts: splitPlan.segments.length,
            originalWidth: splitPlan.width,
            originalHeight: splitPlan.height
          }
        })
      }

      await workPage.close()
      this.cleanupFile(localPath)

      debugLog('summary.longImage', '长图已自动拆分', {
        name: imageMeta.name || path.basename(localPath),
        originalHeight: splitPlan.height,
        originalWidth: splitPlan.width,
        triggerHeight: splitConfig.triggerHeight,
        chunkHeight: splitConfig.chunkHeight,
        overlap: splitConfig.overlap,
        splitCount: files.length
      })

      return files
    } catch (error) {
      logger.warn(`[${pluginName}] 长图拆分失败，已回退原图：${error.message}`)
      this.cleanupFiles(segmentPaths)
      return [{ ...imageMeta, localPath }]
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }

  async downloadImages(images, prefix = 'img', maxCount = 20) {
    const files = []
    const targets = images || []
    const totalLimit = Math.max(0, Number(maxCount) || 0)
    const meta = {
      requestedSourceCount: targets.length,
      processedSourceCount: 0,
      skippedSourceCount: 0,
      skippedSegmentCount: 0,
      limited: false
    }

    if (totalLimit <= 0) {
      Object.defineProperty(files, 'summaryMeta', {
        value: {
          ...meta,
          skippedSourceCount: targets.length,
          limited: targets.length > 0
        },
        enumerable: false,
        configurable: true
      })
      return files
    }

    for (let index = 0; index < targets.length && files.length < totalLimit; index += 1) {
      const image = targets[index]
      meta.processedSourceCount = index + 1
      let ext = this.isGifUrl(image.url) ? 'gif' : 'jpg'
      let localPath = await this.downloadFile(image.url, `${prefix}_${Date.now()}_${index}.${ext}`)
      let isGif = ext === 'gif'

      if (!localPath) {
        continue
      }

      try {
        const buffer = fs.readFileSync(localPath)
        isGif = this.looksLikeGif(buffer)

        if (isGif && !localPath.endsWith('.gif')) {
          const newPath = localPath.replace(/\.[^.]+$/, '.gif')
          fs.renameSync(localPath, newPath)
          localPath = newPath
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 识别图片类型失败：${error.message}`)
      }

      if (isGif) {
        const staticPath = await this.convertGifToStaticImage(localPath)
        if (!staticPath) {
          logger.warn(`[${pluginName}] GIF 无法转为静态图，已跳过：${image.url}`)
          this.cleanupFile(localPath)
          continue
        }

        this.cleanupFile(localPath)
        localPath = staticPath
      }

      const remainingSlots = totalLimit - files.length
      const preparedFiles = await this.splitLongImage(localPath, {
        type: 'image',
        url: image.url,
        name: image.name || ''
      })

      if (preparedFiles.length > remainingSlots) {
        this.cleanupFiles(preparedFiles.slice(remainingSlots))
        meta.skippedSegmentCount += preparedFiles.length - remainingSlots
        meta.limited = true
        logger.warn(
          `[${pluginName}] 长图拆分后图片数量超过上限，已截断剩余 ${preparedFiles.length - remainingSlots} 张：${image.url}`
        )
      }

      files.push(...preparedFiles.slice(0, remainingSlots))
    }

    if (meta.processedSourceCount < targets.length) {
      meta.skippedSourceCount += targets.length - meta.processedSourceCount
      meta.limited = true
    }

    Object.defineProperty(files, 'summaryMeta', {
      value: meta,
      enumerable: false,
      configurable: true
    })

    return files
  }

  async downloadVideos(videos, prefix = 'video', maxCount = 3, options = {}) {
    const files = []
    const targets = (videos || []).slice(0, maxCount)
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000)

    for (let index = 0; index < targets.length; index += 1) {
      const video = targets[index]
      const localPath = await this.downloadFile(video.url, `${prefix}_${Date.now()}_${index}.mp4`, {
        timeoutMs
      })
      if (!localPath) {
        continue
      }

      const stats = fs.statSync(localPath)
      if (stats.size > 50 * 1024 * 1024) {
        this.cleanupFile(localPath)
        logger.warn(`[${pluginName}] 视频文件过大，已跳过：${video.url}`)
        continue
      }

      files.push({ type: 'video', localPath, url: video.url })
    }

    return files
  }

  async downloadAudios(audios, prefix = 'audio', maxCount = 5) {
    const files = []
    const targets = (audios || []).slice(0, maxCount)

    for (let index = 0; index < targets.length; index += 1) {
      const audio = targets[index]
      const localPath = await this.downloadFile(audio.url, `${prefix}_${Date.now()}_${index}.mp3`)
      if (localPath) {
        files.push({ type: 'audio', localPath, url: audio.url })
      }
    }

    return files
  }

  async convertAudioToMp3(audioPath) {
    const targetPath = audioPath.replace(/\.[^.]+$/, '_converted.mp3')

    try {
      await exec(`ffmpeg -i "${audioPath}" -ac 1 -ar 16000 -acodec libmp3lame -y "${targetPath}"`, {
        timeout: 60000
      })
      return targetPath
    } catch (error) {
      logger.warn(`[${pluginName}] 音频转 MP3 失败：${error.message}`)
      return null
    }
  }

  async renderHtmlToImage(html) {
    let browser = null
    this.ensureTempDir()
    const imagePath = path.join(this.tempDir, `render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`)

    try {
      browser = await this.launchBrowser()

      const page = await browser.newPage()
      await page.setViewport({ width: 760, height: 1200, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      await page.evaluate(async () => {
        if (document.fonts?.ready) {
          await document.fonts.ready
        }

        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })

      const clip = await page.evaluate(() => {
        const body = document.body
        const journal = document.querySelector('.journal')
        const target = journal || body
        const targetRect = target.getBoundingClientRect()
        const bodyStyle = getComputedStyle(body)
        const paddingRight = parseFloat(bodyStyle.paddingRight) || 0
        const paddingBottom = parseFloat(bodyStyle.paddingBottom) || 0
        const shadowBleed = 28

        return {
          width: Math.max(1, Math.ceil(targetRect.right + paddingRight + shadowBleed)),
          height: Math.max(1, Math.ceil(targetRect.bottom + paddingBottom + shadowBleed))
        }
      })

      await page.setViewport({
        width: Math.max(760, clip.width),
        height: Math.max(320, Math.min(clip.height, 1200)),
        deviceScaleFactor: 2
      })
      await page.screenshot({
        path: imagePath,
        type: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: clip.width,
          height: clip.height
        }
      })
      return imagePath
    } catch (error) {
      logger.error(`[${pluginName}] HTML 转图片失败：${error.message}`)
      this.cleanupFile(imagePath)
      return null
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }

  async captureScreenshot(url, index = 0, mode = 'viewport', options = {}) {
    let browser = null
    this.ensureTempDir()
    const imagePath = path.join(this.tempDir, `cite_${Date.now()}_${index}.png`)
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000)
    const waitUntil = options.waitUntil || 'domcontentloaded'

    try {
      browser = await this.launchBrowser()

      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 })
      await page.goto(url, { waitUntil, timeout: timeoutMs })
      await page.screenshot({
        path: imagePath,
        fullPage: mode === 'full'
      })

      return imagePath
    } catch (error) {
      logger.warn(`[${pluginName}] 来源截图失败：${error.message} (${url})`)
      this.cleanupFile(imagePath)
      return null
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }
}

export default MediaService

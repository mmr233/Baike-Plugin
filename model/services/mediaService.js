import fs from 'node:fs'
import path from 'node:path'
import { exec as execCallback, execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { debugLog } from '../debug.js'

const exec = promisify(execCallback)
const execFile = promisify(execFileCallback)
const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
const RAW_VIDEO_SIZE_LIMIT_BYTES = 50 * 1024 * 1024
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

  createTempMediaPath(prefix = 'media', ext = '.tmp') {
    this.ensureTempDir()
    return path.join(
      this.tempDir,
      `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    )
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

  parseDurationSeconds(value, fallback = 0) {
    const durationSeconds = Number(value)
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return durationSeconds
    }

    return fallback
  }

  formatFfmpegSeconds(value = 0) {
    return Math.max(0, Number(value) || 0).toFixed(3)
  }

  getVideoPreprocessConfig() {
    const config = Config.get('fileRequest.videoPreprocess', {})
    const compressTriggerSizeMb = clampNumber(config?.compressTriggerSizeMb, 5, 200, 18)
    const compressTargetSizeMb = clampNumber(
      config?.compressTargetSizeMb,
      4,
      compressTriggerSizeMb,
      Math.min(12, compressTriggerSizeMb)
    )
    const splitTriggerDurationSeconds = clampNumber(
      config?.splitTriggerDurationSeconds,
      15,
      7200,
      90
    )
    const segmentDurationSeconds = clampNumber(
      config?.segmentDurationSeconds,
      10,
      splitTriggerDurationSeconds,
      Math.min(45, splitTriggerDurationSeconds)
    )
    const maxSegments = clampNumber(config?.maxSegments, 1, 24, 6)

    return {
      enabled: config?.enabled !== false,
      compressTriggerSizeMb,
      compressTargetSizeMb,
      splitTriggerDurationSeconds,
      segmentDurationSeconds,
      maxSegments,
      maxOutputWidth: 1280,
      audioBitrateKbps: 96,
      minVideoBitrateKbps: 320,
      maxVideoBitrateKbps: 2800,
      ffprobeTimeoutMs: 30000,
      ffmpegTimeoutMs: 8 * 60 * 1000,
      maxPreparedSizeBytes: Math.max(
        24 * 1024 * 1024,
        Math.round(compressTargetSizeMb * 1024 * 1024 * 2)
      )
    }
  }

  async execTool(command, args = [], options = {}) {
    return execFile(command, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      ...options
    })
  }

  async probeVideo(localPath = '') {
    if (!localPath || !fs.existsSync(localPath)) {
      return null
    }

    const fallbackStats = fs.statSync(localPath)

    try {
      const preprocessConfig = this.getVideoPreprocessConfig()
      const { stdout } = await this.execTool('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        localPath
      ], {
        timeout: preprocessConfig.ffprobeTimeoutMs
      })

      const parsed = JSON.parse(stdout || '{}')
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
      const videoStream = streams.find(item => item?.codec_type === 'video') || {}
      const audioStream = streams.find(item => item?.codec_type === 'audio') || {}

      return {
        durationSeconds: this.parseDurationSeconds(
          parsed?.format?.duration,
          this.parseDurationSeconds(videoStream?.duration, this.parseDurationSeconds(audioStream?.duration, 0))
        ),
        sizeBytes: Number(parsed?.format?.size) || fallbackStats.size,
        bitRate: Number(parsed?.format?.bit_rate) || Number(videoStream?.bit_rate) || 0,
        audioBitRate: Number(audioStream?.bit_rate) || 0,
        width: Number(videoStream?.width) || 0,
        height: Number(videoStream?.height) || 0,
        codecName: String(videoStream?.codec_name || '').trim(),
        hasAudio: Boolean(audioStream?.codec_name)
      }
    } catch (error) {
      logger.warn(`[${pluginName}] 视频信息探测失败：${error.message}`)
      return {
        durationSeconds: 0,
        sizeBytes: fallbackStats.size,
        bitRate: 0,
        audioBitRate: 0,
        width: 0,
        height: 0,
        codecName: '',
        hasAudio: true
      }
    }
  }

  calculateTargetVideoBitrateKbps(durationSeconds, options = {}) {
    const config = {
      targetSizeMb: 12,
      audioBitrateKbps: 96,
      minVideoBitrateKbps: 320,
      maxVideoBitrateKbps: 2800,
      ...options
    }

    if (!durationSeconds || durationSeconds <= 0) {
      return Math.min(config.maxVideoBitrateKbps, Math.max(config.minVideoBitrateKbps, 1200))
    }

    const totalBitrateKbps = Math.floor((config.targetSizeMb * 8192) / Math.max(durationSeconds, 1))
    const videoBitrateKbps = totalBitrateKbps - Math.max(48, Number(config.audioBitrateKbps) || 96) - 32

    return clampNumber(
      videoBitrateKbps,
      config.minVideoBitrateKbps,
      config.maxVideoBitrateKbps,
      config.minVideoBitrateKbps
    )
  }

  shouldSplitVideo(videoMeta = {}, config = this.getVideoPreprocessConfig()) {
    if (!config.enabled) {
      return false
    }

    return this.parseDurationSeconds(videoMeta?.durationSeconds, 0) > config.splitTriggerDurationSeconds
  }

  shouldCompressVideo(videoMeta = {}, config = this.getVideoPreprocessConfig()) {
    if (!config.enabled) {
      return false
    }

    const sizeBytes = Number(videoMeta?.sizeBytes) || 0
    const width = Number(videoMeta?.width) || 0
    return sizeBytes > config.compressTriggerSizeMb * 1024 * 1024 || width > config.maxOutputWidth
  }

  async extractVideoSegment(inputPath, outputPath, startSeconds, durationSeconds, timeoutMs) {
    const start = this.formatFfmpegSeconds(startSeconds)
    const duration = this.formatFfmpegSeconds(durationSeconds)

    try {
      await this.execTool('ffmpeg', [
        '-v', 'error',
        '-ss', start,
        '-t', duration,
        '-i', inputPath,
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c', 'copy',
        '-reset_timestamps', '1',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ], {
        timeout: timeoutMs
      })

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return outputPath
      }
    } catch {}

    this.cleanupFile(outputPath)

    await this.execTool('ffmpeg', [
      '-v', 'error',
      '-ss', start,
      '-t', duration,
      '-i', inputPath,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '30',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ], {
      timeout: timeoutMs
    })

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return outputPath
    }

    throw new Error('视频分段输出为空')
  }

  async splitVideoIntoSegments(localPath, sourceMeta = {}, options = {}) {
    const config = {
      ...this.getVideoPreprocessConfig(),
      ...(options || {})
    }
    const durationSeconds = this.parseDurationSeconds(sourceMeta?.durationSeconds, 0)

    if (!this.shouldSplitVideo({ durationSeconds }, config)) {
      return [{
        localPath,
        startSeconds: 0,
        endSeconds: durationSeconds,
        durationSeconds,
        segmentIndex: 1,
        totalSegments: 1
      }]
    }

    const desiredSegments = Math.ceil(durationSeconds / Math.max(10, config.segmentDurationSeconds))
    const totalSegments = Math.max(2, Math.min(config.maxSegments, desiredSegments))
    const segmentSpan = durationSeconds / totalSegments
    const segmentPaths = []
    const segments = []

    try {
      for (let index = 0; index < totalSegments; index += 1) {
        const startSeconds = Number((index * segmentSpan).toFixed(3))
        const endSeconds = index === totalSegments - 1
          ? durationSeconds
          : Number(Math.min(durationSeconds, ((index + 1) * segmentSpan)).toFixed(3))
        const currentDurationSeconds = Math.max(0.3, Number((endSeconds - startSeconds).toFixed(3)))
        const segmentPath = this.createTempMediaPath(
          `${options.prefix || 'video'}_part_${index + 1}`,
          '.mp4'
        )

        await this.extractVideoSegment(
          localPath,
          segmentPath,
          startSeconds,
          currentDurationSeconds,
          config.ffmpegTimeoutMs
        )

        segmentPaths.push(segmentPath)
        segments.push({
          localPath: segmentPath,
          startSeconds,
          endSeconds,
          durationSeconds: currentDurationSeconds,
          segmentIndex: index + 1,
          totalSegments
        })
      }

      debugLog('media.videoSplit', '视频已自动切分', {
        source: path.basename(localPath),
        durationSeconds: Number(durationSeconds.toFixed(3)),
        segmentDurationSeconds: config.segmentDurationSeconds,
        totalSegments
      })

      return segments
    } catch (error) {
      logger.warn(`[${pluginName}] 视频切分失败，已回退原视频：${error.message}`)
      this.cleanupFiles(segmentPaths)
      return [{
        localPath,
        startSeconds: 0,
        endSeconds: durationSeconds,
        durationSeconds,
        segmentIndex: 1,
        totalSegments: 1
      }]
    }
  }

  async compressVideo(inputPath, videoMeta = {}, options = {}) {
    if (!inputPath || !fs.existsSync(inputPath)) {
      return null
    }

    const config = {
      ...this.getVideoPreprocessConfig(),
      ...(options || {})
    }
    const outputPath = this.createTempMediaPath(
      `${path.basename(inputPath, path.extname(inputPath))}_compressed`,
      '.mp4'
    )
    const durationSeconds = this.parseDurationSeconds(videoMeta?.durationSeconds, 0)
    const audioBitrateKbps = videoMeta?.hasAudio === false ? 0 : clampNumber(
      Math.round((Number(videoMeta?.audioBitRate) || 0) / 1000) || config.audioBitrateKbps,
      64,
      192,
      config.audioBitrateKbps
    )
    const videoBitrateKbps = this.calculateTargetVideoBitrateKbps(durationSeconds, {
      targetSizeMb: config.compressTargetSizeMb,
      audioBitrateKbps,
      minVideoBitrateKbps: config.minVideoBitrateKbps,
      maxVideoBitrateKbps: config.maxVideoBitrateKbps
    })
    const maxRateKbps = Math.max(videoBitrateKbps, Math.round(videoBitrateKbps * 1.25))
    const bufferSizeKbps = Math.max(videoBitrateKbps * 2, 1024)
    const args = [
      '-v', 'error',
      '-i', inputPath,
      '-vf', `scale='min(iw,${config.maxOutputWidth})':-2:force_original_aspect_ratio=decrease`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${maxRateKbps}k`,
      '-bufsize', `${bufferSizeKbps}k`,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ]

    if (videoMeta?.hasAudio === false) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`)
    }

    args.push('-y', outputPath)

    try {
      await this.execTool('ffmpeg', args, {
        timeout: config.ffmpegTimeoutMs
      })

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return outputPath
      }
    } catch (error) {
      logger.warn(`[${pluginName}] 视频压缩失败：${error.message}`)
    }

    this.cleanupFile(outputPath)
    return null
  }

  async prepareVideoForLLM(localPath, videoMeta = {}, options = {}) {
    if (!localPath || !fs.existsSync(localPath)) {
      return []
    }

    const config = {
      ...this.getVideoPreprocessConfig(),
      ...(options || {})
    }
    const sourceProbe = await this.probeVideo(localPath)
    const sourceSizeBytes = Number(sourceProbe?.sizeBytes) || fs.statSync(localPath).size
    const sourceMeta = {
      durationSeconds: this.parseDurationSeconds(sourceProbe?.durationSeconds, 0),
      sizeBytes: sourceSizeBytes,
      bitRate: Number(sourceProbe?.bitRate) || 0,
      audioBitRate: Number(sourceProbe?.audioBitRate) || 0,
      width: Number(sourceProbe?.width) || 0,
      height: Number(sourceProbe?.height) || 0,
      hasAudio: sourceProbe?.hasAudio !== false
    }
    const sourceKey = `${videoMeta.url || localPath}:${sourceMeta.durationSeconds || 0}:${sourceMeta.sizeBytes || 0}`

    if (!config.enabled) {
      if (sourceMeta.sizeBytes > RAW_VIDEO_SIZE_LIMIT_BYTES) {
        this.cleanupFile(localPath)
        logger.warn(`[${pluginName}] 视频文件过大，已跳过：${videoMeta.url || localPath}`)
        return []
      }

      return [{
        ...videoMeta,
        type: 'video',
        localPath,
        url: videoMeta.url,
        videoProcessMeta: {
          sourceKey,
          segmentIndex: 1,
          totalSegments: 1,
          startSeconds: 0,
          endSeconds: sourceMeta.durationSeconds,
          durationSeconds: sourceMeta.durationSeconds,
          wasSplit: false,
          wasCompressed: false,
          sourceDurationSeconds: sourceMeta.durationSeconds,
          sourceSizeBytes: sourceMeta.sizeBytes,
          preparedSizeBytes: sourceMeta.sizeBytes,
          width: sourceMeta.width,
          height: sourceMeta.height
        }
      }]
    }

    const splitSegments = await this.splitVideoIntoSegments(localPath, sourceMeta, {
      ...config,
      prefix: options.prefix || 'video'
    })
    const shouldCleanupOriginal = splitSegments.some(item => item.localPath !== localPath)
    const preparedFiles = []
    let compressedCount = 0

    for (const segment of splitSegments) {
      let workingPath = segment.localPath
      let currentProbe = await this.probeVideo(workingPath)
      let currentMeta = {
        durationSeconds: this.parseDurationSeconds(currentProbe?.durationSeconds, segment.durationSeconds || sourceMeta.durationSeconds),
        sizeBytes: Number(currentProbe?.sizeBytes) || fs.statSync(workingPath).size,
        bitRate: Number(currentProbe?.bitRate) || 0,
        audioBitRate: Number(currentProbe?.audioBitRate) || sourceMeta.audioBitRate,
        width: Number(currentProbe?.width) || sourceMeta.width,
        height: Number(currentProbe?.height) || sourceMeta.height,
        hasAudio: currentProbe?.hasAudio !== false
      }
      let wasCompressed = false

      if (this.shouldCompressVideo(currentMeta, config)) {
        const previousPath = workingPath
        const compressedPath = await this.compressVideo(workingPath, currentMeta, config)
        if (compressedPath && fs.existsSync(compressedPath)) {
          const compressedProbe = await this.probeVideo(compressedPath)
          const compressedMeta = {
            durationSeconds: this.parseDurationSeconds(compressedProbe?.durationSeconds, currentMeta.durationSeconds),
            sizeBytes: Number(compressedProbe?.sizeBytes) || fs.statSync(compressedPath).size,
            bitRate: Number(compressedProbe?.bitRate) || 0,
            audioBitRate: Number(compressedProbe?.audioBitRate) || currentMeta.audioBitRate,
            width: Number(compressedProbe?.width) || currentMeta.width,
            height: Number(compressedProbe?.height) || currentMeta.height,
            hasAudio: compressedProbe?.hasAudio !== false
          }

          if (compressedPath !== previousPath) {
            this.cleanupFile(previousPath)
          }

          workingPath = compressedPath
          currentMeta = compressedMeta
          wasCompressed = true
          compressedCount += 1
        } else if (currentMeta.sizeBytes > RAW_VIDEO_SIZE_LIMIT_BYTES) {
          if (workingPath !== localPath) {
            this.cleanupFile(workingPath)
          }
          logger.warn(`[${pluginName}] 视频压缩失败且片段仍过大，已跳过：${videoMeta.url || localPath}`)
          continue
        }
      }

      if (currentMeta.sizeBytes > config.maxPreparedSizeBytes) {
        if (workingPath !== localPath) {
          this.cleanupFile(workingPath)
        }
        logger.warn(
          `[${pluginName}] 视频片段仍然过大，已跳过：${videoMeta.url || localPath} (${Math.round(currentMeta.sizeBytes / 1024 / 1024)}MB)`
        )
        continue
      }

      preparedFiles.push({
        ...videoMeta,
        type: 'video',
        localPath: workingPath,
        url: videoMeta.url,
        videoProcessMeta: {
          sourceKey,
          segmentIndex: segment.segmentIndex,
          totalSegments: segment.totalSegments,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          durationSeconds: currentMeta.durationSeconds,
          wasSplit: segment.totalSegments > 1,
          wasCompressed,
          sourceDurationSeconds: sourceMeta.durationSeconds,
          sourceSizeBytes: sourceMeta.sizeBytes,
          preparedSizeBytes: currentMeta.sizeBytes,
          width: currentMeta.width,
          height: currentMeta.height
        }
      })
    }

    if (shouldCleanupOriginal) {
      this.cleanupFile(localPath)
    }

    if (preparedFiles.length > 0 && (compressedCount > 0 || splitSegments.length > 1)) {
      debugLog('media.videoPrepare', '视频预处理完成', {
        source: videoMeta.url || path.basename(localPath),
        sourceDurationSeconds: Number(sourceMeta.durationSeconds.toFixed(3)),
        sourceSizeMb: Number((sourceMeta.sizeBytes / 1024 / 1024).toFixed(2)),
        outputCount: preparedFiles.length,
        splitCount: splitSegments.length,
        compressedCount
      })
    }

    return preparedFiles
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
    const maxPreparedCount = Number.isFinite(Number(options.maxPreparedCount))
      ? Math.max(0, Math.floor(Number(options.maxPreparedCount)))
      : Number.POSITIVE_INFINITY
    const meta = {
      requestedSourceCount: targets.length,
      processedSourceCount: 0,
      skippedSourceCount: 0,
      skippedSegmentCount: 0,
      splitSourceCount: 0,
      compressedSegmentCount: 0,
      limited: false
    }

    for (let index = 0; index < targets.length; index += 1) {
      if (files.length >= maxPreparedCount) {
        meta.skippedSourceCount += targets.length - index
        meta.limited = true
        break
      }

      const video = targets[index]
      meta.processedSourceCount = index + 1
      const localPath = await this.downloadFile(video.url, `${prefix}_${Date.now()}_${index}.mp4`, {
        timeoutMs
      })
      if (!localPath) {
        continue
      }

      const preparedFiles = await this.prepareVideoForLLM(localPath, {
        type: 'video',
        url: video.url,
        name: video.name || ''
      }, {
        prefix
      })

      if (preparedFiles.some(item => item?.videoProcessMeta?.totalSegments > 1)) {
        meta.splitSourceCount += 1
      }
      meta.compressedSegmentCount += preparedFiles.filter(item => item?.videoProcessMeta?.wasCompressed).length

      const remainingSlots = maxPreparedCount - files.length
      if (preparedFiles.length > remainingSlots) {
        this.cleanupFiles(preparedFiles.slice(remainingSlots))
        meta.skippedSegmentCount += preparedFiles.length - remainingSlots
        meta.limited = true
        logger.warn(
          `[${pluginName}] 视频预处理后片段数量超过上限，已截断剩余 ${preparedFiles.length - remainingSlots} 段：${video.url}`
        )
      }

      files.push(...preparedFiles.slice(0, remainingSlots))
    }

    Object.defineProperty(files, 'summaryMeta', {
      value: meta,
      enumerable: false,
      configurable: true
    })

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

import Config from '../Config.js'

export async function getConfigData() {
  const config = Config.getAll()
  return {
    ...config,
    scheduledSummary: {
      ...config.scheduledSummary,
      groups: (config.scheduledSummary?.groups || []).map(String)
    }
  }
}

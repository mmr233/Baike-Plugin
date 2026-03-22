import { packageInfo } from './constant.js'

const Version = {
  version: packageInfo.version || '1.0.0',
  versionLine: `v${packageInfo.version || '1.0.0'}`
}

export default Version

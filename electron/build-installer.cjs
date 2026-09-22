const path = require('node:path')
const { build } = require('electron-builder')
const { WineVmManager } = require('app-builder-lib/out/vm/WineVm')
const { UninstallerReader } = require('app-builder-lib/out/targets/nsis/nsisUtil')

const signedBuild = process.argv.includes('--signed')

function getBuildOptions() {
  const options = {
    win: ['nsis'],
    x64: true,
  }

  if (!signedBuild) return options

  const signingProvider = process.env.LOCALCUT_SIGNING_PROVIDER?.toLowerCase()
  const hasPfx = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK)
  const azureSignOptions = {
    publisherName: process.env.LOCALCUT_AZURE_PUBLISHER_NAME,
    endpoint: process.env.LOCALCUT_AZURE_ENDPOINT,
    codeSigningAccountName: process.env.LOCALCUT_AZURE_ACCOUNT_NAME,
    certificateProfileName: process.env.LOCALCUT_AZURE_CERTIFICATE_PROFILE_NAME,
  }
  const hasAzureConfig = Object.values(azureSignOptions).every(Boolean)

  if (signingProvider === 'azure') {
    if (!hasAzureConfig) {
      throw new Error('Azure signing requires LOCALCUT_AZURE_PUBLISHER_NAME, LOCALCUT_AZURE_ENDPOINT, LOCALCUT_AZURE_ACCOUNT_NAME, and LOCALCUT_AZURE_CERTIFICATE_PROFILE_NAME.')
    }
    options.config = {
      forceCodeSigning: true,
      win: { azureSignOptions },
    }
    return options
  }

  if (signingProvider === 'pfx' || hasPfx) {
    if (!hasPfx) {
      throw new Error('PFX signing requires WIN_CSC_LINK or CSC_LINK to point to a code-signing certificate.')
    }
    options.config = { forceCodeSigning: true }
    return options
  }

  throw new Error('Signed builds require LOCALCUT_SIGNING_PROVIDER=azure with Azure signing settings, or WIN_CSC_LINK/CSC_LINK for a PFX certificate.')
}

// Electron Builder normally launches the unsigned installer to extract its
// uninstaller. Some Windows security policies block that launch during builds,
// so use Builder's parser directly instead.
const originalExec = WineVmManager.prototype.exec

WineVmManager.prototype.exec = async function extractUninstaller(file, args, options) {
  if (process.platform === 'win32' && file.toLowerCase().endsWith('.exe')) {
    const uninstallerPath = path.join(
      path.dirname(file),
      `${path.basename(file, 'exe')}__uninstaller.exe`,
    )
    await UninstallerReader.exec(file, uninstallerPath)
    return
  }

  return originalExec.call(this, file, args, options)
}

let buildOptions
try {
  buildOptions = getBuildOptions()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

if (buildOptions) build(buildOptions).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function embedSafariExtension(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const projectRoot = path.resolve(__dirname, '..');
  const extensionPath = path.join(
    projectRoot,
    'build',
    'safari-extension',
    'Build',
    'Products',
    'Release',
    'MeetBridgeExtension.appex'
  );
  const appPath = context.appOutDir.endsWith('.app')
    ? context.appOutDir
    : path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const pluginsPath = path.join(appPath, 'Contents', 'PlugIns');

  if (!fs.existsSync(extensionPath)) {
    throw new Error(`Safari extension was not built at ${extensionPath}. Run npm run build:safari-extension first.`);
  }

  fs.mkdirSync(pluginsPath, { recursive: true });
  fs.cpSync(extensionPath, path.join(pluginsPath, 'MeetBridgeExtension.appex'), { recursive: true });
};

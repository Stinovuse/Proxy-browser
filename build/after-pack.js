'use strict';
// Electron fuses: отключаем у готового приложения то, что могут использовать для атак
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,                       // нельзя запустить как Node.js (ELECTRON_RUN_AS_NODE)
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // игнорировать NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false,   // нельзя подключить отладчик через --inspect
    [FuseV1Options.OnlyLoadAppFromAsar]: true,              // код только из app.asar
    [FuseV1Options.EnableCookieEncryption]: true,           // cookies на диске зашифрованы
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log('  • fuses applied to', exe);
};

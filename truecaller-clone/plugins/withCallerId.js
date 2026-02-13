const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin — Caller ID overlay
 * 1. Copies Kotlin source files into the Android project
 * 2. Registers CallReceiver + CallerIdOverlayService in AndroidManifest.xml
 * 3. Registers CallerIdPackage in MainApplication.kt
 */
function withCallerId(config) {
  // ── Step 1: Copy native source files ──────────────────
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, 'plugins', 'caller-id', 'android');
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'com',
        'truecallerclone',
        'app',
      );

      const files = [
        'CallReceiver.kt',
        'CallerIdOverlayService.kt',
        'CallerIdModule.kt',
        'CallerIdPackage.kt',
      ];

      for (const file of files) {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`  ✔ Copied ${file}`);
        } else {
          console.warn(`  ⚠ Source not found: ${src}`);
        }
      }

      return cfg;
    },
  ]);

  // ── Step 2: Add receiver + service to AndroidManifest ─
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];

    // Add CallReceiver
    if (!app.receiver) app.receiver = [];
    const hasReceiver = app.receiver.some(
      (r) => r.$?.['android:name'] === '.CallReceiver',
    );
    if (!hasReceiver) {
      app.receiver.push({
        $: {
          'android:name': '.CallReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.intent.action.PHONE_STATE',
                },
              },
            ],
          },
        ],
      });
      console.log('  ✔ Added CallReceiver to manifest');
    }

    // Add CallerIdOverlayService
    if (!app.service) app.service = [];
    const hasService = app.service.some(
      (s) => s.$?.['android:name'] === '.CallerIdOverlayService',
    );
    if (!hasService) {
      app.service.push({
        $: {
          'android:name': '.CallerIdOverlayService',
          'android:enabled': 'true',
          'android:exported': 'false',
        },
      });
      console.log('  ✔ Added CallerIdOverlayService to manifest');
    }

    return cfg;
  });

  // ── Step 3: Register CallerIdPackage in MainApplication ─
  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes('CallerIdPackage')) {
      // Add to the getPackages() block
      contents = contents.replace(
        '// Packages that cannot be autolinked yet can be added manually here, for example:',
        '// Packages that cannot be autolinked yet can be added manually here, for example:\n              add(CallerIdPackage())',
      );
      cfg.modResults.contents = contents;
      console.log('  ✔ Registered CallerIdPackage in MainApplication');
    }

    return cfg;
  });

  return config;
}

module.exports = withCallerId;

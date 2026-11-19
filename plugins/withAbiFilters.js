// Config plugin: restrict the Android build to phone ABIs.
//
// WHY: a universal APK carries every architecture — arm64-v8a, armeabi-v7a,
// x86 and x86_64. The x86 slices exist for emulators only and are dead weight
// on a real phone.
//
// HOW (important): setting `defaultConfig { ndk { abiFilters } }` in
// app/build.gradle does nothing here — React Native's Gradle plugin derives the
// ABIs it compiles from the `reactNativeArchitectures` Gradle property and
// re-applies them, overriding an abiFilters block in defaultConfig. An earlier
// version of this plugin only did the abiFilters part and the APK size did not
// change by a single byte (104,952,827 → 104,952,839).
//
// So the property is the real lever; the abiFilters block is kept as a
// belt-and-braces guard for third-party modules that ignore the property.
//
// Production ships an AAB, where Play splits per device — this only affects
// the internal test APK.

const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

const PROP = 'reactNativeArchitectures';
const ABIS = 'arm64-v8a,armeabi-v7a';
const MARKER = '// @skillfarm-abi-filters';

function withArchProperty(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const existing = props.find((p) => p.type === 'property' && p.key === PROP);
    if (existing) {
      existing.value = ABIS;
    } else {
      props.push({ type: 'property', key: PROP, value: ABIS });
    }
    return cfg;
  });
}

function withAbiFiltersBlock(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    const injection = `
    ${MARKER}
    // Phone ABIs only — x86/x86_64 are emulator-only payload.
    defaultConfig {
        ndk {
            abiFilters "arm64-v8a", "armeabi-v7a"
        }
    }
`;
    const anchor = /android\s*\{/;
    if (!anchor.test(src)) {
      console.warn('[withAbiFilters] android block not found — skipping');
      return cfg;
    }
    cfg.modResults.contents = src.replace(anchor, (m) => m + injection);
    return cfg;
  });
}

module.exports = function withAbiFilters(config) {
  return withAbiFiltersBlock(withArchProperty(config));
};
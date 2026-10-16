// ===========================================================================
// SkillFarm — app-link claim files (Android App Links + iOS Universal Links).
//
// These make https://skillfarm.netlify.app/course/<id> open the INSTALLED app
// at the OS level. expo export copies public/ into dist/, and Netlify serves
// dist/, so after each deploy the files live at:
//   https://skillfarm.netlify.app/.well-known/assetlinks.json
//   https://skillfarm.netlify.app/.well-known/apple-app-site-association
// Both must be served as plain content with status 200 (Netlify does this).
//
// ── HOW TO FILL THE ANDROID PLACEHOLDER ────────────────────────────────────
//   npx eas credentials -p android
//   → choose the project → view the keystore → copy "SHA256 Certificate
//     Fingerprint" (colon-hex, 32 bytes). Paste it below, keep the JSON valid.
//   The fingerprint must be from the EXACT keystore the installed APK was
//   signed with (EAS preview builds share one keystore, so one entry covers
//   preview + production unless you asked EAS for separate ones).
//
// ── HOW TO FILL THE iOS PLACEHOLDER ────────────────────────────────────────
//   1. You need a paid Apple Developer account.
//   2. Find your Team ID: developer.apple.com → Membership details → "Team ID"
//      (10-char, e.g. "A1B2C3D4E5").
//   3. Replace "TEAMID" in the appIDs array; the appID format is
//      <TeamID>.<bundleIdentifier> → e.g. "A1B2C3D4E5.com.skillfarm.app".
//   4. In the Apple developer portal enable the Associated Domains capability
//      for the App ID; the app.json "associatedDomains" entry already requests
//      it in the build.
//
// ── VERIFY AFTER DEPLOY ───────────────────────────────────────────────────
//   Android: https://developers.google.com/digital-asset-links/tools/generator
//   iOS:     https://app-site-association.cdn-apple.com/a/v1/skillfarm.netlify.app
//   Then install the APK, open skillfarm.netlify.app/course/<id> in Chrome —
//   it should offer/launch the app directly. (Google re-verifies periodically;
//   first verification can take a few minutes after the deploy.)
// ===========================================================================

// Android App Links statement. `delegate_permission/common.handle_all_urls`
// is the only relation Android checks for link opening.
export const assetlinks = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.skillfarm.app',
    'sha256_cert_fingerprints': [
      'REPLACE_WITH_YOUR_APK_SHA256_FROM: npx eas credentials -p android',
    ],
  },
};

// iOS Universal Links app-site-association. `apps: []` is REQUIRED and means
// "not using the older team-based format". Paths mirror expo-router routes.
export const appleAppSiteAssociation = {
  'applinks': {
    apps: [],
    details: [
      {
        // Replace TEAMID with your Apple Developer Team ID (see above).
        'appIDs': ['TEAMID.com.skillfarm.app'],
        'components': [
          { '/': '/course/*', comment: 'Shared course pages' },
          { '/': '/org/*', comment: 'Shared organization pages' },
          { '/': '/reset-password', comment: 'Password recovery' },
          { '/': '/', comment: 'Landing' },
        ],
      },
    ],
  },
};

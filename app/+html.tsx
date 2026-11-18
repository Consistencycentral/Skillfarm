// Custom HTML shell for the Expo web export (expo-router).
//
// WHY THIS FILE EXISTS
// The default shell ships no social metadata, so a link pasted into WhatsApp /
// Telegram / LinkedIn showed a bare URL with no preview card. Cloudflare Pages
// serves the same index.html for every route (SPA fallback), so the tags here
// are the site-wide defaults that functions/_middleware.js then rewrites per
// course / organisation page at the edge.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const SITE = 'https://skillfarm.pages.dev';
const TITLE = 'SkillFarm — offline course registration for rural skilling';
const DESCRIPTION =
  'Find in-person agriculture and rural skills training near you. Browse courses by sector and district, request a seat in one tap, and keep your enrolments on your phone.';
const OG_IMAGE = `${SITE}/og-image.png`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={SITE} />
        <meta name="theme-color" content="#2E7D32" />
        <meta name="robots" content="index, follow" />

        {/* Open Graph (WhatsApp, Telegram, Facebook, LinkedIn) */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="SkillFarm" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={SITE} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="SkillFarm — offline course registration" />
        <meta property="og:locale" content="en_IN" />

        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />

        {/* iOS home-screen + PWA colouring */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="SkillFarm" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="application-name" content="SkillFarm" />

        {/* react-native-web recommends this reset for full-height scrolling. */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root { height: 100%; }
              body { margin: 0; background: #F7F9F7; }
              #root { display: flex; flex: 1; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
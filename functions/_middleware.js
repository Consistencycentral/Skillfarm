// Cloudflare Pages Function — per-route link previews (Open Graph / Twitter).
//
// WHY: the site is a client-rendered SPA, so every URL served the same
// index.html. Pasting a course link into WhatsApp/Telegram showed the generic
// site card. This middleware runs at the edge, looks up the course or
// organisation from Supabase's PUBLIC views, and rewrites the social tags in
// the HTML before it is sent.
//
// SCOPE: only GET /course/<id> and /org/<id> are touched. Everything else
// (assets, bundle chunks, auth callbacks, the app shell) is passed through
// untouched via next(). Any error falls back to next() so a preview problem can
// never take the app down.

const SUPABASE_URL = 'https://eyzfbuisexschgrtkcdv.supabase.co';
// Public anon key — already shipped in the web bundle and the APK. Used only to
// read the non-PII public_* views; override with a Pages env var if rotated.
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5emZidWlzZXhzY2hncnRrY2R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NzI2NDksImV4cCI6MjEwMTI0ODY0OX0.McsT4Zl6Exkpb0it6xw5z2bQqPVjbNNB_tNPIdEPK1A';
const SITE = 'https://skillfarm.pages.dev';
const OG_IMAGE = `${SITE}/og-image.png`;

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const clean = (s, fallback) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : fallback;
};

async function supabaseGet(anonKey, path) {
  if (!anonKey) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

function courseMeta(row, id) {
  if (!row) {
    return {
      title: 'Course on SkillFarm',
      description:
        'Browse in-person agriculture and rural skills training on SkillFarm. Request a seat in one tap.',
      url: `${SITE}/course/${id}`,
    };
  }
  const place = [row.city, row.state].filter(Boolean).join(', ');
  const heading = `${clean(row.title, 'Course')}${place ? ` — ${place}` : ''}`;
  const bits = [];
  if (row.provider_name) bits.push(`by ${row.provider_name}`);
  if (place) bits.push(`at ${place}`);
  if (row.category) bits.push(String(row.category).replace(/_/g, ' '));
  if (row.fee) bits.push(`Rs ${row.fee}`);
  return {
    title: `${heading} | SkillFarm`,
    description: clean(
      row.description,
      `In-person training${bits.length ? ` ${bits.join(' · ')}` : ''}. See batches, seats and fees on SkillFarm.`
    ).slice(0, 200),
    url: `${SITE}/course/${id}`,
  };
}

function orgMeta(row, id) {
  if (!row) {
    return {
      title: 'Learning Partner on SkillFarm',
      description: 'See the training courses this Learning Partner runs on SkillFarm.',
      url: `${SITE}/org/${id}`,
    };
  }
  const place = clean(row.org_address, '');
  const name = clean(row.org_name, 'Learning Partner');
  return {
    title: `${name}${place ? ` — ${place}` : ''} | SkillFarm`,
    description: clean(
      row.org_about,
      `${name} runs in-person skill training${place ? ` in ${place}` : ''}. View their courses and seats on SkillFarm.`
    ).slice(0, 200),
    url: `${SITE}/org/${id}`,
  };
}

/** Site-wide default card (landing, login, unknown routes). */
function defaultMeta(pathname) {
  return {
    title: 'SkillFarm — offline course registration for rural skilling',
    description:
      'Find in-person agriculture and rural skills training near you. Browse courses by sector and district, request a seat in one tap, and keep your enrolments on your phone.',
    url: `${SITE}${pathname === '/' ? '/' : pathname}`,
  };
}

/**
 * Replace the shell's default social tags with route-specific ones.
 * Every substitution is optional — whatever tags the shell has get rewritten,
 * and missing ones are appended before </head>.
 */
function inject(html, meta) {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const u = escapeHtml(meta.url);

  let out = html
    .replace(/<title>[^<]*<\/title>/i, `<title>${t}</title>`)
    .replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${d}" />`)
    .replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${u}" />`)
    .replace(/<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${OG_IMAGE}" />`)
    .replace(/<meta name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${t}" />`)
    .replace(/<meta name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${d}" />`)
    .replace(/<meta name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${OG_IMAGE}" />`)
    .replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${d}" />`)
    .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${u}" />`);

  if (!out.includes(`content="${u}"`)) {
    const block = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="SkillFarm" />`,
      `<meta property="og:title" content="${t}" />`,
      `<meta property="og:description" content="${d}" />`,
      `<meta property="og:url" content="${u}" />`,
      `<meta property="og:image" content="${OG_IMAGE}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${t}" />`,
      `<meta name="twitter:description" content="${d}" />`,
      `<meta name="twitter:image" content="${OG_IMAGE}" />`,
      `<link rel="canonical" href="${u}" />`,
    ].join('\n    ');
    out = out.replace('</head>', `    ${block}\n  </head>`);
  }
  return out;
}

export async function onRequest(context) {
  const { request, next, env } = context;

  try {
    const url = new URL(request.url);
    const isGet = request.method === 'GET' || request.method === 'HEAD';

    // Files (anything with an extension) and non-GET requests are untouched.
    if (!isGet || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return next();

    const course = url.pathname.match(/^\/course\/([A-Za-z0-9-]{6,})/);
    const org = url.pathname.match(/^\/org\/([A-Za-z0-9-]{6,})/);

    // Without a bindable ASSETS namespace we cannot read the shell — bail out
    // rather than fetching our own URL (that would recurse forever).
    if (!env || !env.ASSETS) return next();

    const anonKey =
      env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

    let meta;
    if (course || org) {
      const id = course ? course[1] : org[1];
      try {
        if (course) {
          const row = await supabaseGet(
            anonKey,
            `public_courses?id=eq.${id}&select=title,description,city,state,category,provider_name,fee,duration_weeks&limit=1`
          );
          meta = courseMeta(row, id);
        } else {
          const row = await supabaseGet(
            anonKey,
            `public_orgs?id=eq.${id}&select=org_name,org_about,org_type,org_address,org_sectors&limit=1`
          );
          meta = orgMeta(row, id);
        }
      } catch {
        meta = course ? courseMeta(null, id) : orgMeta(null, id);
      }
    } else {
      // Landing / login / any other human route: site-wide card.
      meta = defaultMeta(url.pathname);
    }

    const shellUrl = new URL('/index.html', url);
    const assetRes = await env.ASSETS.fetch(shellUrl.toString());
    if (!assetRes || !assetRes.ok) return next();

    const html = await assetRes.text();
    if (!html || !html.includes('</head>')) return next();

    return new Response(inject(html, meta), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=0, must-revalidate',
        'x-skillfarm-preview': course ? 'course' : 'org',
      },
    });
  } catch {
    return next();
  }
}
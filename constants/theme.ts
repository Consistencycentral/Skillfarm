// Central design tokens for SkillFarm.
// One place for colour, type, spacing, radius and elevation, so every screen
// reads as one product. Existing keys are kept (the whole app imports them);
// new tokens are additive.
//
// Direction: calm, confident "agri-tech" — deep field green as the single brand
// colour, warm-neutral surfaces, generous whitespace, and semantic status
// colours that never borrow from the brand green.

export const theme = {
  colors: {
    // Brand
    primary: '#1F6B45',
    primaryDark: '#134A2F',
    primaryLight: '#CFE6D6',
    primaryTint: '#EAF3ED',      // soft green wash for selected / highlighted rows
    onPrimary: '#FFFFFF',
    accent: '#2B7A9B',

    // Neutrals
    background: '#F6F8F6',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF4F0',
    border: '#E3E9E5',
    borderStrong: '#CBD5CE',
    text: '#13201A',
    textMuted: '#5B6A61',
    textSubtle: '#8B988F',       // placeholders, disabled, tertiary meta
    overlay: 'rgba(11, 26, 18, 0.45)',

    // Status — each clearly distinct from the brand green
    success: '#1F8A55',
    warning: '#B7791F',
    danger: '#C0392B',
    info: '#2563A8',
    teal: '#0F766E',

    // Soft backgrounds that pair with the status colours (pills, banners)
    successBg: '#E6F4EC',
    warningBg: '#FDF3DC',
    dangerBg: '#FCEAE8',
    infoBg: '#E6EEF9',
    tealBg: '#DFF3F1',
    neutralBg: '#EEF1EF',
  },

  // Registration / booking status → colours + icon. Use <StatusPill status=… />.
  status: {
    registered: { fg: '#1F8A55', bg: '#E6F4EC', icon: 'checkmark-circle' },
    pending:    { fg: '#B7791F', bg: '#FDF3DC', icon: 'time' },
    waitlist:   { fg: '#0F766E', bg: '#DFF3F1', icon: 'hourglass' },
    completed:  { fg: '#2563A8', bg: '#E6EEF9', icon: 'ribbon' },
    cancelled:  { fg: '#5B6A61', bg: '#EEF1EF', icon: 'close-circle' },
    rejected:   { fg: '#C0392B', bg: '#FCEAE8', icon: 'ban' },
  },

  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 },

  radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },

  // Legacy sizes (still used in places)
  font: { body: 16, title: 20, heading: 26 },

  // Type scale. Spread into a Text style: style={theme.type.h1}
  // Weights are deliberately restrained (700 for headings, 600 for emphasis)
  // so the UI feels refined instead of shouty.
  type: {
    display:  { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
    h1:       { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4 },
    h2:       { fontSize: 19, lineHeight: 25, fontWeight: '700', letterSpacing: -0.2 },
    h3:       { fontSize: 16, lineHeight: 22, fontWeight: '700', letterSpacing: -0.1 },
    body:     { fontSize: 15, lineHeight: 22, fontWeight: '400' },
    bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
    small:    { fontSize: 13, lineHeight: 18, fontWeight: '400' },
    caption:  { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1 },
    button:   { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0.1 },
  },

  // Soft, layered shadows. Spread into a style: { ...theme.shadow.card }
  shadow: {
    none: { shadowOpacity: 0, elevation: 0 },
    card: {
      shadowColor: '#0F2A1B',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    raised: {
      shadowColor: '#0F2A1B',
      shadowOpacity: 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  },
} as const;

export type AppTheme = typeof theme;
export type StatusKey = keyof typeof theme.status;

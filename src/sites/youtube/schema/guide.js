// Left sidebar (PLAN §6.3, "Left sidebar"): the full guide (ytd-guide-entry-renderer) and the
// collapsed icon rail (ytd-mini-guide-entry-renderer). Entries are found by their link, never by
// their (translated) title. Entries with no usable link are also matched by the
// `data-at-peace-entry` tag the MAIN-world page bridge sets (contract C5, docs/reviews/phase-0-1.md).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.guide',
    site: 'youtube',
    title: 'Left sidebar',
    order: 120,
  });

  /** Full-guide entry whose link is exactly `href`. */
  const entry = (href) => `ytd-guide-entry-renderer:has(> a#endpoint[href="${href}"])`;
  /** Collapsed-rail twin of the same entry. */
  const mini = (href) => `ytd-mini-guide-entry-renderer:has(a#endpoint[href="${href}"])`;
  /** Entries tagged by the page bridge (both guides). */
  const tagged = (name) => [
    `ytd-guide-entry-renderer[data-at-peace-entry="${name}"]`,
    `ytd-mini-guide-entry-renderer[data-at-peace-entry="${name}"]`,
  ];
  /** A whole guide section (title, entries, divider) that contains a link matching `attr`. */
  const sectionWith = (attr) => `ytd-guide-section-renderer:has(a#endpoint${attr})`;

  // With the guide hidden, YouTube still reserves its width as a left margin on the page; the
  // two attributes say which guide is currently docked (verified: x = 240 / 72 -> 0).
  const CLOSE_GAP = [
    ':scope-on ytd-app[guide-persistent-and-visible] ytd-page-manager#page-manager { margin-left: 0 !important; }',
    ':scope-on ytd-app[mini-guide-visible] ytd-page-manager#page-manager { margin-left: 0 !important; }',
  ];

  AP.schema.define('yt.guide', [
    // ---- Whole sidebar -------------------------------------------------------------------------
    {
      id: 'yt.guide.hideAll',
      group: 'Whole sidebar',
      label: 'Hide the whole sidebar',
      type: 'toggle',
      default: false,
      hide: ['tp-yt-app-drawer#guide', 'ytd-mini-guide-renderer', 'ytd-masthead #guide-button'],
      rules: CLOSE_GAP,
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideMini',
      group: 'Whole sidebar',
      label: 'Hide the icon strip',
      description: 'The narrow bar of icons.',
      type: 'toggle',
      default: false,
      hide: ['ytd-mini-guide-renderer'],
      rules: [':scope-on ytd-app[mini-guide-visible] ytd-page-manager#page-manager { margin-left: 0 !important; }'],
      since: '0.1.0',
    },

    // ---- Entries -------------------------------------------------------------------------------
    {
      id: 'yt.guide.hideHome',
      group: 'Entries',
      label: 'Hide Home',
      type: 'toggle',
      default: false,
      // Not a bare a[href="/"]: the logo link has the same href.
      hide: [entry('/'), mini('/'), ...tagged('home')],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideShorts',
      group: 'Entries',
      label: 'Hide Shorts',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      hide: [
        // Full guide: the only primary entry without a link (it opens through a command).
        'ytd-guide-entry-renderer[is-primary]:has(> a#endpoint:not([href]))',
        entry('/shorts/'),
        // Icon strip: the entry does have a link.
        mini('/shorts/'),
        ...tagged('shorts'),
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideSubscriptionsEntry',
      group: 'Entries',
      label: 'Hide Subscriptions',
      type: 'toggle',
      default: false,
      hide: [entry('/feed/subscriptions'), mini('/feed/subscriptions'), ...tagged('subscriptions')],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideYouEntry',
      group: 'Entries',
      label: 'Hide You',
      description: 'Your library, history and playlists.',
      type: 'toggle',
      default: false,
      hide: [
        entry('/feed/you'),
        entry('/feed/library'),
        mini('/feed/you'),
        // Signed in, "You" is a collapsible section: hide it with the entries under it.
        'ytd-guide-collapsible-section-entry-renderer:has(a#endpoint[href="/feed/you"])',
        ...tagged('you'),
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideHistory',
      group: 'Entries',
      label: 'Hide History',
      type: 'toggle',
      default: false,
      hide: [entry('/feed/history'), mini('/feed/history'), ...tagged('history')],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hidePlaylists',
      group: 'Entries',
      label: 'Hide Playlists',
      type: 'toggle',
      default: false,
      // Signed-in entries: the href is from public sources, the bridge tag is the reliable hook.
      hide: [entry('/feed/playlists'), ...tagged('playlists')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideYourVideos',
      group: 'Entries',
      label: 'Hide Your videos',
      type: 'toggle',
      default: false,
      hide: ['ytd-guide-entry-renderer:has(> a#endpoint[href^="https://studio.youtube.com/channel/"])', ...tagged('your-videos')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideWatchLater',
      group: 'Entries',
      label: 'Hide Watch later',
      type: 'toggle',
      default: false,
      hide: [entry('/playlist?list=WL'), ...tagged('watch-later')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideLiked',
      group: 'Entries',
      label: 'Hide Liked videos',
      type: 'toggle',
      default: false,
      hide: [entry('/playlist?list=LL'), ...tagged('liked')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideDownloads',
      group: 'Entries',
      label: 'Hide Downloads',
      type: 'toggle',
      default: false,
      hide: [entry('/feed/downloads'), ...tagged('downloads')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideCourses',
      group: 'Entries',
      label: 'Hide Your courses',
      type: 'toggle',
      default: false,
      hide: [entry('/feed/courses'), ...tagged('courses')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },

    // ---- Sections ------------------------------------------------------------------------------
    {
      id: 'yt.guide.hideSubscriptionsSection',
      group: 'Sections',
      label: 'Hide the channel list',
      type: 'toggle',
      default: false,
      // Signed-in only, so not verifiable logged out. The list ends with "All subscriptions"
      // (/feed/channels); the second form is a "Show more" list of /@handle channels. A bare
      // :has(a[href^="/@"]) is avoided: "Your channel" in the You section also links to a handle.
      hide: [sectionWith('[href="/feed/channels"]'), 'ytd-guide-section-renderer:has(> #items > ytd-guide-collapsible-entry-renderer a#endpoint[href^="/@"])'],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideExploreSection',
      group: 'Sections',
      label: 'Hide Explore',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      // The section has no language-free marker of its own; it is the one that links to
      // YouTube's own topic channels (ids are YouTube-owned and have been stable for years).
      hide: [
        sectionWith('[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"]'), // Music
        sectionWith('[href="/channel/UC4R8DWoMoI7CAwX8_LjQHig"]'), // Live
        sectionWith('[href="/channel/UCkYQyvc_i9hXEo4xic9Hh2g"]'), // Shopping
        sectionWith('[href="/channel/UCOpNcN46UbXVtpKMrmU4Abg"]'), // Gaming
        sectionWith('[href="/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"]'), // News
        sectionWith('[href="/channel/UCEgdi0XIXXZ-qJOFPf4JSKw"]'), // Sports
        sectionWith('[href="/feed/trending"]'),
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideMoreFromYouTube',
      group: 'Sections',
      label: 'Hide "More from YouTube"',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      hide: [
        sectionWith('[href*="youtubekids.com"]'),
        sectionWith('[href*="tv.youtube.com"]'),
        sectionWith('[href^="https://music.youtube.com"]'),
        sectionWith('[href="/premium"]'),
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideSettingsSection',
      group: 'Sections',
      label: 'Hide Settings and Help',
      type: 'toggle',
      default: false,
      hide: [sectionWith('[href="/reporthistory"]'), sectionWith('[href="/account"]')],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideFooter',
      group: 'Sections',
      label: 'Hide the footer links',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      hide: ['ytd-guide-renderer #footer'],
      since: '0.1.0',
    },
    {
      id: 'yt.guide.hideSignInPromo',
      group: 'Sections',
      label: 'Hide the sign-in box',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      hide: ['ytd-guide-signin-promo-renderer'],
      since: '0.1.0',
    },
  ]);
})();

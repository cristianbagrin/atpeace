// Channel pages (PLAN §6.3, "Channel"): `/@handle`, `/channel/…` and their tabs. Page-scoped to
// `channel`; all selectors start with ytd-browse[page-subtype="channels"] (every channel tab).
//
// Tabs (yt-tab-shape) carry no link and only a translated title, so they are hidden through the
// `data-at-peace-tab` attribute that the MAIN-world page bridge sets (contract C5): those
// settings are marked `feature: 'bridgeTags'` and do nothing until the bridge runs.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.channel',
    site: 'youtube',
    title: 'Channel pages',
    order: 200,
    description: 'The header, tabs and Home page of a channel.',
  });

  const CHANNEL = 'ytd-browse[page-subtype="channels"]';
  const tab = (name) => `${CHANNEL} yt-tab-shape[data-at-peace-tab="${name}"]`;
  // The Home tab is the first tab, and it is the selected one. Only then are the item sections
  // below shelves of the Home tab (on Posts / Playlists the same component holds the content).
  const ON_HOME_TAB = `${CHANNEL}:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"])`;
  const HEADER_META = `${CHANNEL} .ytPageHeaderViewModelContentMetadata`;
  const DELIM = '.ytContentMetadataViewModelDelimiter';
  const TEXT = '.ytContentMetadataViewModelMetadataText';
  const SUBS = `${TEXT}:has(+ ${DELIM} + ${TEXT}:nth-last-child(1 of ${TEXT}))`;
  // One row of the Home tab, by what it holds (data-at-peace-shelf, set by the page bridge from the row's own data,
  // never from its title). The item section around the row goes too, so no empty gap is left. Only on the Home tab:
  // on Playlists the same component holds that tab's content.
  const row = (type) => [`${ON_HOME_TAB} ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="${type}"])`, `${ON_HOME_TAB} [data-at-peace-shelf="${type}"]`];
  const action = (name) => [`${CHANNEL} [data-at-peace-channel-action="${name}"]`];
  const HOME_SHELF = ':is(ytd-shelf-renderer, ytd-channel-video-player-renderer, ytd-reel-shelf-renderer, grid-shelf-view-model)';

  AP.schema.define('yt.channel', [
    // ---- Opening a channel ---------------------------------------------------------------------
    {
      id: 'yt.channel.openVideosTab',
      group: 'Opening a channel',
      label: 'Open channels on their Videos tab',
      description: 'Skips the channel Home page and goes straight to the list of videos.',
      type: 'toggle',
      default: false,
      page: 'channel',
      feature: 'channel-tab',
      since: '0.1.0',
    },

    // ---- Home tab ------------------------------------------------------------------------------
    {
      id: 'yt.channel.hideTrailer',
      group: 'Home tab',
      label: 'Hide the featured video',
      description: 'Removes the video that autoplays at the top of a channel\'s Home tab.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [`${CHANNEL} ytd-item-section-renderer:has(> #contents > ytd-channel-video-player-renderer)`, `${CHANNEL} ytd-channel-video-player-renderer`],
      // CSS hides the player; channel-tab.js also pauses it so a hidden trailer cannot keep playing.
      feature: 'channel-tab',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideHomeShelves',
      group: 'Home tab',
      label: 'Hide all rows',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      page: 'channel',
      hide: [`${ON_HOME_TAB} ytd-item-section-renderer:has(> #contents > ${HOME_SHELF})`],
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideRowShorts',
      group: 'Home tab',
      label: 'Hide the Shorts row',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      page: 'channel',
      // The reel shelf needs no tag; the tag also catches a row of Shorts that YouTube draws as a plain shelf.
      hide: [...row('shorts'), `${ON_HOME_TAB} ytd-item-section-renderer:has(> #contents > ytd-reel-shelf-renderer)`, `${ON_HOME_TAB} ytd-reel-shelf-renderer`],
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowPosts',
      group: 'Home tab',
      label: 'Hide the Posts row',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('posts'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowMembers',
      group: 'Home tab',
      label: 'Hide the members-only row',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('members'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowLive',
      group: 'Home tab',
      label: 'Hide live and upcoming rows',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('live'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowPopular',
      group: 'Home tab',
      label: 'Hide the popular videos row',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('popular'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowPlaylists',
      group: 'Home tab',
      label: 'Hide the playlists row',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('playlists'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideRowChannels',
      group: 'Home tab',
      label: 'Hide featured channels',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: row('channels'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },

    // ---- Header --------------------------------------------------------------------------------
    {
      id: 'yt.channel.hideBanner',
      group: 'Header',
      label: 'Hide the banner picture',
      description: 'Removes the large banner image at the top of a channel.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [`${CHANNEL} #page-header-banner`, `${CHANNEL} yt-image-banner-view-model`, `${CHANNEL} .page-header-banner`],
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideJoinButton',
      group: 'Header',
      label: 'Hide the Join button',
      type: 'toggle',
      default: false,
      page: 'channel',
      // Both headers: the button wrapper tagged by the bridge, and the older header's #sponsor-button (also tagged).
      hide: action('join'),
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideSubscriberCount',
      group: 'Header',
      label: 'Hide the subscriber count',
      description: 'Removes "519M subscribers" from the channel header; the video count stays.',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      page: 'channel',
      // The header reads "@handle • 519M subscribers • 1K videos" (the handle may be a row of its own). The
      // subscriber count is the part right before "delimiter + last part"; the handle never is, wherever it sits.
      hide: [
        `${HEADER_META} ${SUBS}`,
        `${HEADER_META} ${SUBS} + ${DELIM}`,
      ],
      since: '0.1.0',
    },

    // ---- Tabs ----------------------------------------------------------------------------------
    {
      id: 'yt.channel.hideShortsTab',
      group: 'Tabs',
      label: 'Hide the Shorts tab',
      description: 'Removes the Shorts tab from channels, and the Shorts row on the channel Home tab.',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      page: 'channel',
      hide: [tab('shorts')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideLiveTab',
      group: 'Tabs',
      label: 'Hide the Live tab',
      description: 'Removes the Live (past streams) tab from channels.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('streams')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hidePodcastsTab',
      group: 'Tabs',
      label: 'Hide the Podcasts tab',
      description: 'Removes the Podcasts tab from channels.',
      type: 'toggle',
      default: false,
      advanced: true,
      page: 'channel',
      hide: [tab('podcasts')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hidePlaylistsTab',
      group: 'Tabs',
      label: 'Hide the Playlists tab',
      description: 'Removes the Playlists tab from channels.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('playlists')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hidePostsTab',
      group: 'Tabs',
      label: 'Hide the Posts tab',
      description: 'Removes the Posts (community) tab from channels.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('posts')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideStoreTab',
      group: 'Tabs',
      label: 'Hide the Store tab',
      description: 'Removes the Store (merchandise) tab from channels that have one.',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('store')],
      feature: 'bridgeTags',
      since: '0.1.0',
    },
    {
      id: 'yt.channel.hideShowsTab',
      group: 'Tabs',
      label: 'Hide the Shows tab',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('shows')],
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideCoursesTab',
      group: 'Tabs',
      label: 'Hide the Courses tab',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('courses')],
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideMembersTab',
      group: 'Tabs',
      label: 'Hide the Members tab',
      type: 'toggle',
      default: false,
      page: 'channel',
      hide: [tab('members')],
      feature: 'bridgeTags',
      since: '0.2.0',
    },
    {
      id: 'yt.channel.hideReleasesTab',
      group: 'Tabs',
      label: 'Hide the Releases tab',
      type: 'toggle',
      default: false,
      advanced: true,
      page: 'channel',
      hide: [tab('releases')],
      feature: 'bridgeTags',
      since: '0.2.0',
    },
  ]);
})();

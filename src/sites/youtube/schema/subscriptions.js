// Subscriptions feed (PLAN §6.3, "Subscriptions"; setting ids are `yt.subs.*`). Page-scoped to
// `subscriptions`. The feed is the same ytd-rich-grid-renderer as the home page, so the same
// card/shelf rules apply. Logged out it only shows a sign-in prompt, so most of these are built
// from public sources and the shared card markup and cannot be verified without an account.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.subs',
    site: 'youtube',
    title: 'Subscriptions feed',
    order: 190,
    description: 'Trim the feed of videos from channels you follow.',
  });

  const SUBS = 'ytd-browse[page-subtype="subscriptions"]';
  const PROGRESS = 'yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer';

  AP.schema.define('yt.subs', [
    {
      id: 'yt.subs.hideShorts',
      group: 'Hide from the feed',
      label: 'Hide Shorts',
      description: 'Removes Shorts rows and single Shorts from your subscriptions feed.',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      page: 'subscriptions',
      hide: [
        `${SUBS} ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])`,
        `${SUBS} ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)`,
        `${SUBS} ytd-reel-shelf-renderer`,
        `${SUBS} ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)`,
        `${SUBS} ytd-rich-item-renderer:has(a[href^="/shorts/"])`,
        `${SUBS} ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])`,
        `${SUBS} ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])`,
        `${SUBS} ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.subs.hidePosts',
      group: 'Hide from the feed',
      label: 'Hide community posts',
      description: 'Removes posts (polls, images and text) from channels you follow.',
      type: 'toggle',
      default: false,
      page: 'subscriptions',
      hide: [
        `${SUBS} ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])`,
        `${SUBS} ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])`,
        `${SUBS} ytd-rich-item-renderer[is-post]`,
        `${SUBS} ytd-rich-item-renderer:has(ytd-post-renderer)`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.subs.hideLive',
      group: 'Hide from the feed',
      label: 'Hide live streams',
      description: 'Removes streams that are live right now from your subscriptions feed.',
      type: 'toggle',
      default: false,
      page: 'subscriptions',
      // The LIVE badge class is language-free (observed on lockups elsewhere); the card wrapper is hidden.
      hide: [
        `${SUBS} ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailLive)`,
        `${SUBS} ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeLive)`,
        `${SUBS} ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"])`,
        `${SUBS} ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"])`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.subs.hideUpcoming',
      group: 'Hide from the feed',
      label: 'Hide upcoming premieres',
      description: 'Removes scheduled streams and premieres that have not started yet.',
      type: 'toggle',
      default: false,
      page: 'subscriptions',
      hide: [
        `${SUBS} ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailUpcoming)`,
        `${SUBS} ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"])`,
        `${SUBS} ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"])`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.subs.hideWatched',
      group: 'Hide from the feed',
      label: 'Hide videos you have watched',
      description: 'Removes videos that show a red progress bar from your subscriptions feed.',
      type: 'toggle',
      default: false,
      page: 'subscriptions',
      hide: [
        `${SUBS} ytd-rich-item-renderer:has(${PROGRESS})`,
        `${SUBS} ytd-grid-video-renderer:has(${PROGRESS})`,
        `${SUBS} ytd-video-renderer:has(${PROGRESS})`,
      ],
      since: '0.1.0',
    },
  ]);
})();

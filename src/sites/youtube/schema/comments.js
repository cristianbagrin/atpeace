// Comments (PLAN §6.3, "Comments"): the comments under a video, the teaser in the description, and
// the comments panel of Shorts. Not page-scoped on purpose: the same ytd-comments component also
// sits under community posts (/post/…) and inside the Shorts comments panel.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.comments',
    site: 'youtube',
    title: 'Comments',
    order: 160,
    description: 'Comments on videos, Shorts and posts.',
  });

  const SHORTS_COMMENTS_PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]';

  AP.schema.define('yt.comments', [
    {
      id: 'yt.comments.hideAll',
      group: 'Comments',
      label: 'Hide comments',
      description: 'Removes the comments section under videos and posts, and the comments panel and button on Shorts.',
      type: 'toggle',
      default: false,
      tags: ['comments'],
      hide: [
        'ytd-comments#comments',
        'ytd-watch-flexy ytd-comments',
        SHORTS_COMMENTS_PANEL,
        // Shorts: the comments button is the first plain button in the action bar (like and dislike have their own tags).
        'ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)',
        'ytd-reel-player-overlay-renderer #comments-button',
      ],
      quick: true,
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideTeaser',
      group: 'Comments',
      label: 'Hide the comment preview',
      description: 'Removes the single top comment shown inside the description box.',
      type: 'toggle',
      default: false,
      tags: ['comments'],
      page: 'watch',
      hide: ['ytd-watch-flexy #comment-teaser'],
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideCount',
      group: 'Details',
      label: 'Hide the comment count',
      description: 'Removes "2,458 Comments" above the comments; sorting and the comment box stay.',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      hide: ['ytd-comments-header-renderer #count', 'ytd-comments-header-renderer yt-formatted-string.count-text'],
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideAvatars',
      group: 'Details',
      label: 'Hide profile pictures',
      description: 'Removes the round pictures next to comments and next to the "Add a comment" box.',
      type: 'toggle',
      default: false,
      hide: [
        'ytd-comments ytd-comment-view-model #author-thumbnail',
        'ytd-comments ytd-comment-simplebox-renderer #author-thumbnail',
        'ytd-comments ytd-comment-renderer #author-thumbnail',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideLikeCounts',
      group: 'Details',
      label: 'Hide comment like counts',
      description: 'Removes the number next to the thumbs-up on each comment; the buttons stay.',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      hide: ['ytd-comment-engagement-bar #vote-count-middle', 'ytd-comments #vote-count-middle'],
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideReplies',
      group: 'Details',
      label: 'Hide replies',
      description: 'Removes the "N replies" links and reply threads under comments.',
      type: 'toggle',
      default: false,
      hide: ['ytd-comment-thread-renderer #replies', 'ytd-comment-replies-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.comments.hideCreatorHearts',
      group: 'Details',
      label: 'Hide creator hearts',
      description: 'Removes the small red heart a creator can give a comment.',
      type: 'toggle',
      default: false,
      advanced: true,
      hide: ['ytd-comment-engagement-bar #creator-heart', 'ytd-creator-heart-renderer'],
      since: '0.1.0',
    },
  ]);
})();

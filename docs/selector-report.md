# Selector coverage report

Generated 2026-10-08 by `npm run selectors` (offline). Do not edit by hand.

Pages checked (20): channel-home-lofigirl (channel), channel-home-ltt (channel), channel-home (channel), channel-posts (channel), channel-shorts (channel), channel-videos (channel), feed-history (history), feed-subscriptions (subscriptions), hashtag (hashtag), home-narrow (home), home (home), playlist (playlist), search-lofi (search), search-mrbeast (search), search-rice (search), shorts (shorts), watch-chapters (watch), watch-live (watch), watch-music (watch), watch-playlist (watch).

Source: exact DOM snapshots of a **logged-out** browser (`tests/e2e/artifacts/research/*.dom.json`). They carry no CSS, so the "covers more than 60 % of the screen" check only runs with `--live`. Signed-in-only UI (Create button, signed-in sidebar, home feed, subscriptions feed) is not in them.

## Summary

| | count |
|---|---|
| Settings with CSS | 141 |
| JS-only settings (no selector) | 12 |
| Selectors checked | 420 |
| ✅ matched | 203 |
| ⚠️ 0 matches | 217 |
| ❌ invalid selector | 0 |
| 🚫 matches something it must not | 0 |

## Settings

A setting is ✅ when at least one of its selectors matched on an expected page, ⚠️ when none did.

| Setting | Page | Selectors | Matched | Status |
|---|---|---|---|---|
| `yt.general.grayscale` | all | 1 | 1 | ✅ |
| `yt.general.thumbnails=blur` | all | 2 | 2 | ✅ |
| `yt.general.thumbnails=grayscale` | all | 2 | 2 | ✅ |
| `yt.general.thumbnails=hide` | all | 1 | 1 | ✅ |
| `yt.general.disableHoverPreview` | all | 3 | 2 | ✅ |
| `yt.general.hideViewCounts` | all | 15 | 8 | ✅ |
| `yt.general.hideUploadDates` | all | 8 | 6 | ✅ |
| `yt.general.hideDurations` | all | 2 | 2 | ✅ |
| `yt.general.hideChannelAvatars` | all | 4 | 4 | ✅ |
| `yt.general.hideBadges` | all | 6 | 6 | ✅ |
| `yt.general.hideWatchedProgress` | all | 3 | 2 | ✅ |
| `yt.general.hideWatched` | all | 5 | 1 | ✅ |
| `yt.general.hideAds` | all | 15 | 3 | ✅ |
| `yt.general.hidePremiumUpsells` | all | 6 | 0 | ⚠️ |
| `yt.general.hideMixes` | all | 4 | 0 | ⚠️ |
| `yt.general.hidePlayables` | home | 4 | 0 | ⚠️ |
| `yt.masthead.hideSearchSuggestions` | all | 2 | 1 | ✅ |
| `yt.masthead.hideSearchHistory` | all | 1 | 0 | ⚠️ |
| `yt.masthead.hideVoiceSearch` | all | 1 | 1 | ✅ |
| `yt.masthead.hideSearchBar` | all | 3 | 3 | ✅ |
| `yt.masthead.hideCreate` | all | 1 | 0 | ⚠️ |
| `yt.masthead.hideNotifications` | all | 1 | 0 | ⚠️ |
| `yt.masthead.hideGuideButton` | all | 1 | 1 | ✅ |
| `yt.masthead.hideAICompanion` | all | 1 | 1 | ✅ |
| `yt.masthead.hideCountryCode` | all | 1 | 1 | ✅ |
| `yt.masthead.hideDoodle` | all | 4 | 2 | ✅ |
| `yt.masthead.hideMastheadAd` | all | 5 | 1 | ✅ |
| `yt.guide.hideAll` | all | 5 | 5 | ✅ |
| `yt.guide.hideMini` | all | 2 | 2 | ✅ |
| `yt.guide.hideHome` | all | 4 | 2 | ✅ |
| `yt.guide.hideShorts` | all | 5 | 2 | ✅ |
| `yt.guide.hideSubscriptionsEntry` | all | 4 | 2 | ✅ |
| `yt.guide.hideYouEntry` | all | 6 | 2 | ✅ |
| `yt.guide.hideHistory` | all | 4 | 1 | ✅ |
| `yt.guide.hidePlaylists` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideYourVideos` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideWatchLater` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideLiked` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideDownloads` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideCourses` | all | 3 | 0 | ⚠️ |
| `yt.guide.hideSubscriptionsSection` | all | 2 | 0 | ⚠️ |
| `yt.guide.hideExploreSection` | all | 7 | 3 | ✅ |
| `yt.guide.hideMoreFromYouTube` | all | 4 | 3 | ✅ |
| `yt.guide.hideSettingsSection` | all | 2 | 1 | ✅ |
| `yt.guide.hideFooter` | all | 1 | 1 | ✅ |
| `yt.guide.hideSignInPromo` | all | 1 | 1 | ✅ |
| `yt.home.feedMode=hide` | home | 1 | 1 | ✅ |
| `yt.home.feedMode=subscriptions` | home | 1 | 1 | ✅ |
| `yt.home.feedMode=watchLater` | home | 1 | 1 | ✅ |
| `yt.home.feedMode=playlists` | home | 1 | 1 | ✅ |
| `yt.home.feedMode=custom` | home | 1 | 1 | ✅ |
| `yt.home.hideChips` | home | 5 | 1 | ✅ |
| `yt.home.hideShortsShelf` | home | 7 | 0 | ⚠️ |
| `yt.home.hideNewsShelf` | home | 1 | 0 | ⚠️ |
| `yt.home.hidePostsShelf` | home | 4 | 0 | ⚠️ |
| `yt.home.hideOtherShelves` | home | 3 | 1 | ✅ |
| `yt.home.hideFeedNudge` | home | 3 | 2 | ✅ |
| `yt.watch.hideRelated` | watch | 4 | 4 | ✅ |
| `yt.watch.hideRelatedShorts` | watch | 4 | 0 | ⚠️ |
| `yt.watch.hideRelatedChips` | watch | 4 | 0 | ⚠️ |
| `yt.watch.hideLiveChat` | watch | 2 | 2 | ✅ |
| `yt.watch.hidePlayerAds` | watch | 5 | 2 | ✅ |
| `yt.watch.hideShoppingShelf` | watch | 6 | 4 | ✅ |
| `yt.watch.hideMerch` | watch | 2 | 1 | ✅ |
| `yt.watch.hideTickets` | watch | 1 | 1 | ✅ |
| `yt.watch.hideFundraiser` | watch | 2 | 1 | ✅ |
| `yt.watch.hideHashtags` | watch | 2 | 1 | ✅ |
| `yt.watch.hideOwnerAvatar` | watch | 2 | 2 | ✅ |
| `yt.watch.hideSubscriberCount` | watch | 1 | 1 | ✅ |
| `yt.watch.hideJoinButton` | watch | 3 | 2 | ✅ |
| `yt.watch.hideLikeCounts` | watch | 4 | 1 | ✅ |
| `yt.watch.hideLikeButtons` | watch | 5 | 3 | ✅ |
| `yt.watch.hideShare` | watch | 2 | 1 | ✅ |
| `yt.watch.hideDownload` | watch | 2 | 1 | ✅ |
| `yt.watch.hideClip` | watch | 2 | 0 | ⚠️ |
| `yt.watch.hideThanks` | watch | 1 | 0 | ⚠️ |
| `yt.watch.hideSave` | watch | 2 | 1 | ✅ |
| `yt.watch.hideAsk` | watch | 1 | 0 | ⚠️ |
| `yt.watch.hideMoreActions` | watch | 3 | 2 | ✅ |
| `yt.watch.hideViewCount` | watch | 3 | 3 | ✅ |
| `yt.watch.hideUploadDate` | watch | 4 | 4 | ✅ |
| `yt.watch.hideDescription` | watch | 2 | 2 | ✅ |
| `yt.watch.hideAISummary` | watch | 4 | 1 | ✅ |
| `yt.watch.hideChapters` | watch | 4 | 4 | ✅ |
| `yt.watch.hideDescriptionExtras` | watch | 8 | 6 | ✅ |
| `yt.watch.hideInfoPanels` | watch | 3 | 1 | ✅ |
| `yt.watch.hideAmbientMode` | all | 7 | 7 | ✅ |
| `yt.player.hideEndscreenCards` | all | 1 | 0 | ⚠️ |
| `yt.player.hideEndscreenWall` | all | 3 | 1 | ✅ |
| `yt.player.hideInfoCards` | all | 2 | 2 | ✅ |
| `yt.player.hidePauseOverlay` | all | 2 | 0 | ⚠️ |
| `yt.player.hideWatermark` | all | 2 | 0 | ⚠️ |
| `yt.player.hidePaidPromotion` | all | 2 | 1 | ✅ |
| `yt.player.hideAutoplayToggle` | all | 2 | 2 | ✅ |
| `yt.player.hideNextButton` | all | 1 | 1 | ✅ |
| `yt.player.hideMiniplayerButton` | all | 1 | 0 | ⚠️ |
| `yt.player.hideCastButton` | all | 1 | 1 | ✅ |
| `yt.player.hideSubtitlesButton` | all | 1 | 1 | ✅ |
| `yt.player.hideChapterTitle` | all | 1 | 1 | ✅ |
| `yt.player.hideProgressPreviews` | all | 3 | 3 | ✅ |
| `yt.comments.hideAll` | all | 5 | 4 | ✅ |
| `yt.comments.hideTeaser` | watch | 1 | 1 | ✅ |
| `yt.comments.hideCount` | all | 2 | 2 | ✅ |
| `yt.comments.hideAvatars` | all | 3 | 2 | ✅ |
| `yt.comments.hideLikeCounts` | all | 2 | 2 | ✅ |
| `yt.comments.hideReplies` | all | 2 | 2 | ✅ |
| `yt.comments.hideCreatorHearts` | all | 2 | 2 | ✅ |
| `yt.search.hideShorts` | search | 5 | 4 | ✅ |
| `yt.search.hideShelves` | search | 1 | 1 | ✅ |
| `yt.search.hideRelatedSearches` | search | 2 | 0 | ⚠️ |
| `yt.search.hideAds` | search | 5 | 0 | ⚠️ |
| `yt.search.hideAISummary` | search | 3 | 3 | ✅ |
| `yt.search.hideChannelResults` | search | 1 | 1 | ✅ |
| `yt.search.hideSnippets` | search | 4 | 4 | ✅ |
| `yt.search.hideFilterChips` | search | 2 | 2 | ✅ |
| `yt.shorts.mode=watch` | shorts | 1 | 1 | ✅ |
| `yt.shorts.mode=block` | shorts | 1 | 1 | ✅ |
| `yt.shorts.hideComments` | shorts | 3 | 2 | ✅ |
| `yt.shorts.hideLikeCounts` | shorts | 2 | 2 | ✅ |
| `yt.shorts.hideRemix` | shorts | 2 | 1 | ✅ |
| `yt.shorts.hideSubscribe` | shorts | 2 | 1 | ✅ |
| `yt.subs.hideShorts` | subscriptions | 8 | 0 | ⚠️ |
| `yt.subs.hidePosts` | subscriptions | 4 | 0 | ⚠️ |
| `yt.subs.hideLive` | subscriptions | 4 | 0 | ⚠️ |
| `yt.subs.hideUpcoming` | subscriptions | 3 | 0 | ⚠️ |
| `yt.subs.hideWatched` | subscriptions | 3 | 0 | ⚠️ |
| `yt.channel.hideTrailer` | channel | 2 | 2 | ✅ |
| `yt.channel.hideHomeShelves` | channel | 1 | 1 | ✅ |
| `yt.channel.hideRowShorts` | channel | 4 | 2 | ✅ |
| `yt.channel.hideRowPosts` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideRowMembers` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideRowLive` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideRowPopular` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideRowPlaylists` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideRowChannels` | channel | 2 | 0 | ⚠️ |
| `yt.channel.hideBanner` | channel | 3 | 2 | ✅ |
| `yt.channel.hideJoinButton` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideSubscriberCount` | channel | 2 | 2 | ✅ |
| `yt.channel.hideShortsTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideLiveTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hidePodcastsTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hidePlaylistsTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hidePostsTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideStoreTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideShowsTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideCoursesTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideMembersTab` | channel | 1 | 0 | ⚠️ |
| `yt.channel.hideReleasesTab` | channel | 1 | 0 | ⚠️ |
| `yt.general.thumbnailFrame` | all | – | – | JS (thumbnail-frame) |
| `yt.home.redirectUrl` | home | – | – | JS (home-feed) |
| `yt.watch.disableAutoplay` | watch | – | – | JS (autoplay) |
| `yt.watch.noAutoStart` | watch | – | – | JS (autoplay) |
| `yt.watch.autoTheater` | watch | – | – | JS (theater) |
| `yt.watch.defaultSpeed` | watch | – | – | JS (speed) |
| `yt.watch.dismissStillWatching` | watch | – | – | JS (still-watching) |
| `yt.channel.openVideosTab` | channel | – | – | JS (channel-tab) |
| `yt.filters.keywords` | all | – | – | JS (filters) |
| `yt.filters.channels` | all | – | – | JS (filters) |
| `yt.filters.applyTo` | all | – | – | JS (filters) |
| `yt.filters.commentKeywords` | watch | – | – | JS (filters) |

## Selectors

| Setting | Selector | Page | Matches | Status | Seen on / note |
|---|---|---|---|---|---|
| `yt.general.grayscale` | `:scope-on filter: grayscale(1) !important;` | all | 1 | ✅ matched | styles the page root |
| `yt.general.thumbnails=blur` | `rule: :is(yt-thumbnail-view-model .ytThumbnailViewModelImage > img, ytd-thumbnail img, ytd-playlist-thumbnail img, yt-collection-thumbnail-view-model img, .ytp-modern-videowall-still-image, .ytp-videowall-still-image, .…` | all | 565 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 54, channel-home 12 |
| `yt.general.thumbnails=blur` | `rule: :is(yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer,…` | all | 562 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 54, channel-home 12 |
| `yt.general.thumbnails=grayscale` | `rule: :is(yt-thumbnail-view-model .ytThumbnailViewModelImage > img, ytd-thumbnail img, ytd-playlist-thumbnail img, yt-collection-thumbnail-view-model img, .ytp-modern-videowall-still-image, .ytp-videowall-still-image, .…` | all | 565 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 54, channel-home 12 |
| `yt.general.thumbnails=grayscale` | `rule: :is(yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer,…` | all | 562 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 54, channel-home 12 |
| `yt.general.thumbnails=hide` | `rule: :is(yt-thumbnail-view-model, ytd-thumbnail, ytd-playlist-thumbnail, yt-collection-thumbnail-view-model, .ytp-modern-videowall-still-image, .ytp-videowall-still-image, .ytp-ce-covering-image)` | all | 649 | ✅ matched | channel-home-lofigirl 26, channel-home-ltt 62, channel-home 14 |
| `yt.general.disableHoverPreview` | `ytd-app #video-preview` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.disableHoverPreview` | `ytd-video-preview` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.disableHoverPreview` | `ytd-thumbnail-overlay-loading-preview-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)) .ytContentMetadataViewModelLeadingIcon` | all | 242 | ✅ matched | channel-home-lofigirl 18, channel-home-ltt 36, channel-home 12 |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)) .ytContentMetadataViewModelLeadingIcon + .ytContentMetadataViewModelMetadataText` | all | 242 | ✅ matched | channel-home-lofigirl 18, channel-home-ltt 36, channel-home 12 |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)) .ytContentMetadataViewModelLeadingIcon + .ytContentMetadataViewModelMetadataText + .ytContentMetadataViewModelDelimiter` | all | 241 | ✅ matched | channel-home-lofigirl 17, channel-home-ltt 36, channel-home 12 |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)):not(:has(badge-shape.ytBadgeShapeThumbnailLive)):not(:has(.ytContentMetadataViewModelLeadingIcon)) .ytContentMetadataViewModelMetadataText:has(+ .ytCont…` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)):not(:has(badge-shape.ytBadgeShapeThumbnailLive)):not(:has(.ytContentMetadataViewModelLeadingIcon)) .ytContentMetadataViewModelMetadataText:has(+ .ytCont…` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:has(badge-shape.ytBadgeShapeThumbnailLive) .ytContentMetadataViewModelMetadataRow:nth-child(2 of .ytContentMetadataViewModelMetadataRow):not(:has(.ytContentMetadataViewModelBadge))` | all | 18 | ✅ matched | channel-home-lofigirl 7, watch-chapters 5, watch-live 5 |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:has(badge-shape.ytBadgeShapeThumbnailLive) .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > .ytContentMetadataViewModelMetadataText:nth-last-child(1 of .ytContent…` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `yt-lockup-view-model:has(badge-shape.ytBadgeShapeThumbnailLive) .ytContentMetadataViewModelMetadataRow > .ytContentMetadataViewModelDelimiter:has(+ .ytContentMetadataViewModelMetadataText:nth-last-child(1 of .ytContentM…` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `.shortsLockupViewModelHostOutsideMetadataSubhead` | all | 96 | ✅ matched | channel-home-ltt 6, channel-shorts 45, search-lofi 20 |
| `yt.general.hideViewCounts` | `ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(1)` | all | 95 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.hideViewCounts` | `ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(1)` | all | 36 | ✅ matched | hashtag 36 |
| `yt.general.hideViewCounts` | `ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `ytd-compact-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `ytd-playlist-video-renderer #video-info > span:nth-of-type(1)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideViewCounts` | `rule: ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)::before` | all | 91 | ✅ matched | channel-home-ltt 1, channel-home 1, hashtag 36 |
| `yt.general.hideUploadDates` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)):not(:has(badge-shape.ytBadgeShapeThumbnailLive)) .ytContentMetadataViewModelMetadataRow > .ytContentMetadataViewModelDelimiter + .ytContentMetadataViewM…` | all | 252 | ✅ matched | channel-home-lofigirl 21, channel-home-ltt 42, channel-home 12 |
| `yt.general.hideUploadDates` | `yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)):not(:has(badge-shape.ytBadgeShapeThumbnailLive)) .ytContentMetadataViewModelMetadataRow > .ytContentMetadataViewModelDelimiter:has(+ .ytContentMetadataV…` | all | 252 | ✅ matched | channel-home-lofigirl 21, channel-home-ltt 42, channel-home 12 |
| `yt.general.hideUploadDates` | `ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)` | all | 91 | ✅ matched | channel-home-ltt 1, channel-home 1, hashtag 36 |
| `yt.general.hideUploadDates` | `ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(2)` | all | 36 | ✅ matched | hashtag 36 |
| `yt.general.hideUploadDates` | `ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(2)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideUploadDates` | `ytd-compact-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(2)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideUploadDates` | `rule: [data-at-peace~="yt.general.hideViewCounts"] yt-lockup-view-model:not(:has(yt-collection-thumbnail-view-model)) .ytContentMetadataViewModelMetadataRow > .ytContentMetadataViewModelDelimiter` | all | 252 | ✅ matched | channel-home-lofigirl 21, channel-home-ltt 42, channel-home 12 |
| `yt.general.hideUploadDates` | `rule: [data-at-peace~="yt.general.hideViewCounts"] ytd-video-meta-block #byline-container > #separator` | all | 95 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.hideDurations` | `yt-thumbnail-bottom-overlay-view-model yt-thumbnail-badge-view-model` | all | 267 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 42, channel-home 12 |
| `yt.general.hideDurations` | `ytd-thumbnail-overlay-time-status-renderer` | all | 181 | ✅ matched | hashtag 72, search-lofi 18, search-mrbeast 20 |
| `yt.general.hideChannelAvatars` | `yt-lockup-view-model .ytLockupMetadataViewModelAvatar` | all | 235 | ✅ matched | channel-home-lofigirl 24, channel-home-ltt 42, channel-home 12 |
| `yt.general.hideChannelAvatars` | `ytd-video-renderer #channel-info > a#channel-thumbnail` | all | 56 | ✅ matched | search-lofi 21, search-mrbeast 20, search-rice 15 |
| `yt.general.hideChannelAvatars` | `ytd-video-renderer #channel-info > #avatar` | all | 56 | ✅ matched | search-lofi 21, search-mrbeast 20, search-rice 15 |
| `yt.general.hideChannelAvatars` | `ytd-rich-grid-media #avatar-container` | all | 36 | ✅ matched | hashtag 36 |
| `yt.general.hideBadges` | `yt-lockup-view-model .ytContentMetadataViewModelBadge` | all | 32 | ✅ matched | channel-home-ltt 15, channel-home 12, watch-music 3 |
| `yt.general.hideBadges` | `yt-lockup-view-model .ytContentMetadataViewModelIcon` | all | 143 | ✅ matched | channel-home-lofigirl 23, channel-home-ltt 26, channel-home 6 |
| `yt.general.hideBadges` | `yt-lockup-view-model yt-badge-view-model` | all | 32 | ✅ matched | channel-home-ltt 15, channel-home 12, watch-music 3 |
| `yt.general.hideBadges` | `ytd-video-renderer ytd-badge-supported-renderer` | all | 333 | ✅ matched | search-lofi 123, search-mrbeast 120, search-rice 90 |
| `yt.general.hideBadges` | `ytd-video-renderer yt-badge-supported-renderer` | all | 333 | ✅ matched | search-lofi 123, search-mrbeast 120, search-rice 90 |
| `yt.general.hideBadges` | `ytd-video-renderer #badges` | all | 56 | ✅ matched | search-lofi 21, search-mrbeast 20, search-rice 15 |
| `yt.general.hideWatchedProgress` | `yt-thumbnail-overlay-progress-bar-view-model` | all | 2 | ✅ matched | search-rice 2 |
| `yt.general.hideWatchedProgress` | `ytw-thumbnail-overlay-resume-playback-renderer` | all | 1 | ✅ matched | search-rice 1 |
| `yt.general.hideWatchedProgress` | `ytd-thumbnail-overlay-resume-playback-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideWatched` | `ytd-browse:is([page-subtype="home"], [page-subtype="subscriptions"], [page-subtype="channels"]) ytd-rich-item-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, yt…` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideWatched` | `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideWatched` | `ytd-search ytd-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | all | 2 | ✅ matched | search-rice 2 |
| `yt.general.hideWatched` | `ytd-watch-flexy #related yt-lockup-view-model:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideWatched` | `ytd-watch-flexy #related ytd-compact-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-ad-slot-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-rich-section-renderer:has(> #content > ytd-ad-slot-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-in-feed-ad-layout-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-promoted-sparkles-web-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-promoted-video-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-display-ad-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-carousel-ad-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-action-companion-ad-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-search-pyv-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `ytd-compact-promoted-item-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideAds` | `#masthead-ad` | all | 18 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.hideAds` | `#player-ads` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.general.hideAds` | `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]` | all | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.general.hideAds` | `#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `ytd-mealbar-promo-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `yt-mealbar-promo-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `ytd-banner-promo-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/premium"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/premium"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePremiumUpsells` | `.ytp-quality-menu .ytp-menuitem:has(.ytp-premium-label)` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideMixes` | `ytd-rich-item-renderer:has(yt-collection-thumbnail-view-model):has(a[href*="list=RD"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideMixes` | `yt-lockup-view-model:has(yt-collection-thumbnail-view-model):has(a[href*="list=RD"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideMixes` | `ytd-compact-radio-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hideMixes` | `ytd-radio-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePlayables` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-mini-game-card-view-model)` | home | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePlayables` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer a[href="/playables"])` | home | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePlayables` | `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[has-rounded-box-art-thumbnail-style]` | home | 0 | ⚠️ 0 matches |  |
| `yt.general.hidePlayables` | `ytd-browse[page-subtype="home"] ytd-mini-game-card-view-model` | home | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideSearchSuggestions` | `yt-searchbox .ytSearchboxComponentSuggestionsContainer` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideSearchSuggestions` | `div.sbdd_a` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideSearchHistory` | `yt-searchbox .ytSuggestionComponentSuggestion:has([class*="ytSuggestionComponentRemoveLink"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.masthead.hideVoiceSearch` | `ytd-masthead #voice-search-button` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideSearchBar` | `ytd-masthead #center` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideSearchBar` | `ytd-masthead yt-searchbox` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideSearchBar` | `ytd-masthead #search-button-narrow` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideCreate` | `ytd-masthead #buttons > :is(ytd-button-renderer, ytd-topbar-menu-button-renderer):has(+ ytd-notification-topbar-button-renderer)` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.masthead.hideNotifications` | `ytd-masthead ytd-notification-topbar-button-renderer` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.masthead.hideGuideButton` | `ytd-masthead #guide-button` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideAICompanion` | `ytd-masthead #ai-companion-button` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideCountryCode` | `ytd-topbar-logo-renderer #country-code` | all | 40 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.masthead.hideDoodle` | `ytd-masthead ytd-yoodle-renderer` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideDoodle` | `#big-yoodle` | all | 6 | ✅ matched | channel-shorts 1, channel-videos 1, hashtag 1 |
| `yt.masthead.hideDoodle` | `rule: ytd-topbar-logo-renderer a#logo > div[hidden]` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideDoodle` | `rule: ytd-topbar-logo-renderer a#logo > div > ytd-logo[hidden]` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideMastheadAd` | `#masthead-ad` | all | 18 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.masthead.hideMastheadAd` | `ytd-statement-banner-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideMastheadAd` | `ytd-brand-video-singleton-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideMastheadAd` | `ytd-brand-video-shelf-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.masthead.hideMastheadAd` | `ytd-primetime-promo-renderer` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideAll` | `tp-yt-app-drawer#guide` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideAll` | `ytd-mini-guide-renderer` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideAll` | `ytd-masthead #guide-button` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideAll` | `rule: ytd-app[guide-persistent-and-visible] ytd-page-manager#page-manager` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideAll` | `rule: ytd-app[mini-guide-visible] ytd-page-manager#page-manager` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideMini` | `ytd-mini-guide-renderer` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideMini` | `rule: ytd-app[mini-guide-visible] ytd-page-manager#page-manager` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideHome` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideHome` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/"])` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideHome` | `ytd-guide-entry-renderer[data-at-peace-entry="home"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideHome` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="home"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideShorts` | `ytd-guide-entry-renderer[is-primary]:has(> a#endpoint:not([href]))` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideShorts` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/shorts/"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideShorts` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/shorts/"])` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideShorts` | `ytd-guide-entry-renderer[data-at-peace-entry="shorts"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideShorts` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="shorts"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideSubscriptionsEntry` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/subscriptions"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideSubscriptionsEntry` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/subscriptions"])` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideSubscriptionsEntry` | `ytd-guide-entry-renderer[data-at-peace-entry="subscriptions"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideSubscriptionsEntry` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="subscriptions"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideYouEntry` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/you"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideYouEntry` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/library"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideYouEntry` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/you"])` | all | 1 | ✅ matched | home-narrow 1 |
| `yt.guide.hideYouEntry` | `ytd-guide-collapsible-section-entry-renderer:has(a#endpoint[href="/feed/you"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideYouEntry` | `ytd-guide-entry-renderer[data-at-peace-entry="you"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideYouEntry` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="you"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideHistory` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/history"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideHistory` | `ytd-mini-guide-entry-renderer:has(a#endpoint[href="/feed/history"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideHistory` | `ytd-guide-entry-renderer[data-at-peace-entry="history"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideHistory` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="history"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hidePlaylists` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/playlists"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hidePlaylists` | `ytd-guide-entry-renderer[data-at-peace-entry="playlists"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hidePlaylists` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="playlists"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideYourVideos` | `ytd-guide-entry-renderer:has(> a#endpoint[href^="https://studio.youtube.com/channel/"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideYourVideos` | `ytd-guide-entry-renderer[data-at-peace-entry="your-videos"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideYourVideos` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="your-videos"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideWatchLater` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/playlist?list=WL"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideWatchLater` | `ytd-guide-entry-renderer[data-at-peace-entry="watch-later"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideWatchLater` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="watch-later"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideLiked` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/playlist?list=LL"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideLiked` | `ytd-guide-entry-renderer[data-at-peace-entry="liked"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideLiked` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="liked"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideDownloads` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/downloads"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideDownloads` | `ytd-guide-entry-renderer[data-at-peace-entry="downloads"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideDownloads` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="downloads"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideCourses` | `ytd-guide-entry-renderer:has(> a#endpoint[href="/feed/courses"])` | all | 0 | ⚠️ 0 matches | signed-in / signed-out UI |
| `yt.guide.hideCourses` | `ytd-guide-entry-renderer[data-at-peace-entry="courses"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideCourses` | `ytd-mini-guide-entry-renderer[data-at-peace-entry="courses"]` | all | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.guide.hideSubscriptionsSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/feed/channels"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideSubscriptionsSection` | `ytd-guide-section-renderer:has(> #items > ytd-guide-collapsible-entry-renderer a#endpoint[href^="/@"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC4R8DWoMoI7CAwX8_LjQHig"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UCkYQyvc_i9hXEo4xic9Hh2g"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UCOpNcN46UbXVtpKMrmU4Abg"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/channel/UCEgdi0XIXXZ-qJOFPf4JSKw"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideExploreSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/feed/trending"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideMoreFromYouTube` | `ytd-guide-section-renderer:has(a#endpoint[href*="youtubekids.com"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideMoreFromYouTube` | `ytd-guide-section-renderer:has(a#endpoint[href*="tv.youtube.com"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideMoreFromYouTube` | `ytd-guide-section-renderer:has(a#endpoint[href^="https://music.youtube.com"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideMoreFromYouTube` | `ytd-guide-section-renderer:has(a#endpoint[href="/premium"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideSettingsSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/reporthistory"])` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideSettingsSection` | `ytd-guide-section-renderer:has(a#endpoint[href="/account"])` | all | 0 | ⚠️ 0 matches |  |
| `yt.guide.hideFooter` | `ytd-guide-renderer #footer` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.guide.hideSignInPromo` | `ytd-guide-signin-promo-renderer` | all | 15 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.home.feedMode=hide` | `ytd-browse[page-subtype="home"] #primary` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.feedMode=subscriptions` | `ytd-browse[page-subtype="home"] #primary` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.feedMode=watchLater` | `ytd-browse[page-subtype="home"] #primary` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.feedMode=playlists` | `ytd-browse[page-subtype="home"] #primary` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.feedMode=custom` | `ytd-browse[page-subtype="home"] #primary` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.hideChips` | `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #header` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.hideChips` | `ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideChips` | `ytd-browse[page-subtype="home"] chip-bar-view-model` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideChips` | `ytd-browse[page-subtype="home"] yt-chip-cloud-renderer` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideChips` | `rule: #frosted-glass.with-chipbar` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[is-shorts]` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-reel-shelf-renderer` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(a[href^="/shorts/"])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideShortsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideNewsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(a[href="/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hidePostsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hidePostsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hidePostsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-item-renderer[is-post]` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hidePostsShelf` | `ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-post-renderer)` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideOtherShelves` | `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.hideOtherShelves` | `ytd-browse[page-subtype="home"] ytd-statement-banner-renderer` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideOtherShelves` | `ytd-browse[page-subtype="home"] ytd-brand-video-shelf-renderer` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideFeedNudge` | `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer:has(> #content > ytd-feed-nudge-renderer)` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.home.hideFeedNudge` | `ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(> #content > ytd-feed-nudge-renderer)` | home | 0 | ⚠️ 0 matches |  |
| `yt.home.hideFeedNudge` | `ytd-browse[page-subtype="home"] ytd-feed-nudge-renderer` | home | 2 | ✅ matched | home-narrow 1, home 1 |
| `yt.watch.hideRelated` | `ytd-watch-flexy #related` | watch | 8 | ✅ matched | watch-chapters 2, watch-live 2, watch-music 2 |
| `yt.watch.hideRelated` | `ytd-watch-flexy ytd-watch-next-secondary-results-renderer` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideRelated` | `rule: ytd-watch-flexy:not(:has(#playlist:not([hidden]))):not(:has(ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"])):not([live-chat-present-and-expanded]) #secondary` | watch | 2 | ✅ matched | watch-chapters 1, watch-music 1 |
| `yt.watch.hideRelated` | `rule: [data-at-peace~="yt.watch.hideLiveChat"] ytd-watch-flexy:not(:has(#playlist:not([hidden]))):not(:has(ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"])) #secondary` | watch | 3 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideRelatedShorts` | `#related ytd-reel-shelf-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedShorts` | `#related grid-shelf-view-model:has(ytm-shorts-lockup-view-model)` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedShorts` | `#related yt-lockup-view-model:has(a.ytLockupViewModelContentImage[href^="/shorts/"])` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedShorts` | `#related ytd-compact-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedChips` | `#related yt-related-chip-cloud-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedChips` | `#related yt-chip-cloud-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedChips` | `#related chip-bar-view-model` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideRelatedChips` | `ytd-watch-next-secondary-results-renderer yt-chip-cloud-chip-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideLiveChat` | `ytd-watch-flexy #chat-container` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideLiveChat` | `ytd-live-chat-frame#chat` | watch | 2 | ✅ matched | watch-chapters 1, watch-live 1 |
| `yt.watch.hidePlayerAds` | `#player-ads` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hidePlayerAds` | `ytd-watch-flexy ytd-action-companion-ad-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hidePlayerAds` | `ytd-watch-flexy ytd-companion-slot-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hidePlayerAds` | `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hidePlayerAds` | `.ytp-ad-overlay-container` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideShoppingShelf` | `#shopping-timely-shelf` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideShoppingShelf` | `#product-shelf` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideShoppingShelf` | `#shopping-description-shelf` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideShoppingShelf` | `ytd-engagement-panel-section-list-renderer[target-id^="shopping_panel_for_entry_point"]` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideShoppingShelf` | `.ytp-suggested-action` | watch | 20 | ✅ matched | watch-chapters 5, watch-live 5, watch-music 5 |
| `yt.watch.hideShoppingShelf` | `yt-overlay-product-sticker` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideMerch` | `ytd-merch-shelf-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideMerch` | `ytd-watch-flexy #merch-shelf` | watch | 12 | ✅ matched | watch-chapters 3, watch-live 3, watch-music 3 |
| `yt.watch.hideTickets` | `ytd-watch-flexy #ticket-shelf` | watch | 12 | ✅ matched | watch-chapters 3, watch-live 3, watch-music 3 |
| `yt.watch.hideFundraiser` | `#donation-shelf` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideFundraiser` | `ytd-donation-shelf-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideHashtags` | `ytd-watch-metadata a[href^="/hashtag/"]` | watch | 6 | ✅ matched | watch-music 6 |
| `yt.watch.hideHashtags` | `#super-title` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideOwnerAvatar` | `ytd-watch-metadata ytd-video-owner-renderer #avatar` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideOwnerAvatar` | `ytd-watch-metadata #owner #avatar-stack` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideSubscriberCount` | `ytd-watch-metadata #owner-sub-count` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideJoinButton` | `ytd-watch-metadata #sponsor-button` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideJoinButton` | `ytd-watch-metadata #purchase-button` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideJoinButton` | `ytd-watch-metadata [data-at-peace-action="join"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideLikeCounts` | `ytd-watch-metadata like-button-view-model .ytSpecButtonShapeNextButtonTextContent` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideLikeCounts` | `ytd-watch-metadata like-button-view-model .yt-spec-button-shape-next__button-text-content` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideLikeCounts` | `ytd-watch-metadata dislike-button-view-model .ytSpecButtonShapeNextButtonTextContent` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideLikeCounts` | `ytd-watch-metadata dislike-button-view-model .yt-spec-button-shape-next__button-text-content` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideLikeButtons` | `ytd-watch-metadata segmented-like-dislike-button-view-model` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideLikeButtons` | `ytd-watch-metadata ytd-segmented-like-dislike-button-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideLikeButtons` | `ytd-watch-metadata like-button-view-model` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideLikeButtons` | `ytd-watch-metadata dislike-button-view-model` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideLikeButtons` | `ytd-watch-metadata [data-at-peace-action="like"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideShare` | `ytd-watch-metadata #top-level-buttons-computed > yt-button-view-model:has(path[d^="M10 3.158V7.51"])` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideShare` | `ytd-watch-metadata [data-at-peace-action="share"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideDownload` | `ytd-watch-metadata ytd-download-button-renderer` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideDownload` | `ytd-watch-metadata [data-at-peace-action="download"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideClip` | `ytd-watch-metadata yt-button-view-model:has(path[d^="M8 7c0 .55-.45 1-1 1s-1-.45-1-1"])` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideClip` | `ytd-watch-metadata [data-at-peace-action="clip"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideThanks` | `ytd-watch-metadata [data-at-peace-action="thanks"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideSave` | `ytd-watch-metadata #flexible-item-buttons > yt-button-view-model:has(path[d^="M19 2H5a2 2 0 00-2 2v16"])` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideSave` | `ytd-watch-metadata [data-at-peace-action="save"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideAsk` | `ytd-watch-metadata [data-at-peace-action="ask"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideMoreActions` | `ytd-watch-metadata ytd-menu-renderer > yt-button-shape#button-shape` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideMoreActions` | `ytd-watch-metadata ytd-menu-renderer > yt-icon-button#button` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideMoreActions` | `ytd-watch-metadata [data-at-peace-action="more"]:not(ytd-menu-renderer, #actions, #actions-inner, #menu, #top-level-buttons-computed, #flexible-item-buttons)` | watch | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.watch.hideViewCount` | `ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(1):has(~ span:nth-child(3))` | watch | 2 | ✅ matched | watch-chapters 1, watch-playlist 1 |
| `yt.watch.hideViewCount` | `ytd-watch-metadata ytd-watch-info-text #view-count` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideViewCount` | `ytd-watch-metadata ytd-watch-info-text tp-yt-paper-tooltip` | watch | 3 | ✅ matched | watch-chapters 1, watch-live 1, watch-playlist 1 |
| `yt.watch.hideUploadDate` | `ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(3)` | watch | 2 | ✅ matched | watch-chapters 1, watch-playlist 1 |
| `yt.watch.hideUploadDate` | `ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(1):not(:has(~ span:nth-child(3)))` | watch | 2 | ✅ matched | watch-live 1, watch-music 1 |
| `yt.watch.hideUploadDate` | `ytd-watch-metadata ytd-watch-info-text #date-text` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideUploadDate` | `ytd-watch-metadata ytd-watch-info-text tp-yt-paper-tooltip` | watch | 3 | ✅ matched | watch-chapters 1, watch-live 1, watch-playlist 1 |
| `yt.watch.hideDescription` | `ytd-watch-metadata #description` | watch | 11 | ✅ matched | watch-chapters 3, watch-live 2, watch-music 5 |
| `yt.watch.hideDescription` | `ytd-watch-metadata ytd-text-inline-expander` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideAISummary` | `ytd-watch-flexy ytd-expandable-metadata-renderer:has(video-summary-content-view-model)` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideAISummary` | `ytd-watch-flexy #expandable-metadata:has(video-summary-content-view-model)` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideAISummary` | `ytd-watch-flexy video-summary-content-view-model` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideAISummary` | `ytd-watch-flexy ytd-structured-description-content-renderer #video-summary` | watch | 8 | ✅ matched | watch-chapters 2, watch-live 2, watch-music 2 |
| `yt.watch.hideChapters` | `ytd-watch-flexy ytd-horizontal-card-list-renderer:has(ytd-macro-markers-list-item-renderer)` | watch | 4 | ✅ matched | watch-chapters 2, watch-playlist 2 |
| `yt.watch.hideChapters` | `ytd-watch-flexy ytd-macro-markers-list-renderer` | watch | 2 | ✅ matched | watch-chapters 1, watch-playlist 1 |
| `yt.watch.hideChapters` | `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"]` | watch | 1 | ✅ matched | watch-chapters 1 |
| `yt.watch.hideChapters` | `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-auto-chapters"]` | watch | 1 | ✅ matched | watch-playlist 1 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-horizontal-card-list-renderer:has(yt-video-attribute-view-model)` | watch | 2 | ✅ matched | watch-music 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy yt-video-attribute-view-model` | watch | 2 | ✅ matched | watch-music 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-video-description-music-section-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-video-description-transcript-section-renderer` | watch | 4 | ✅ matched | watch-music 2, watch-playlist 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-video-description-course-section-renderer` | watch | 4 | ✅ matched | watch-chapters 2, watch-live 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-video-description-infocards-section-renderer` | watch | 8 | ✅ matched | watch-chapters 2, watch-live 2, watch-music 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-metadata-row-container-renderer` | watch | 8 | ✅ matched | watch-chapters 2, watch-live 2, watch-music 2 |
| `yt.watch.hideDescriptionExtras` | `ytd-watch-flexy ytd-rich-metadata-row-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideInfoPanels` | `ytd-watch-flexy #clarify-box` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.watch.hideInfoPanels` | `ytd-info-panel-container-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideInfoPanels` | `ytd-clarification-renderer` | watch | 0 | ⚠️ 0 matches |  |
| `yt.watch.hideAmbientMode` | `ytd-watch-flexy #cinematics-container` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.watch.hideAmbientMode` | `ytd-watch-flexy #cinematics` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.watch.hideAmbientMode` | `ytd-watch-flexy #cinematics-full-bleed-container` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.watch.hideAmbientMode` | `#cinematic-container.ytd-reel-video-renderer` | all | 1 | ✅ matched | shorts 1 |
| `yt.watch.hideAmbientMode` | `#shorts-cinematic-container` | all | 1 | ✅ matched | shorts 1 |
| `yt.watch.hideAmbientMode` | `#cinematic-shorts-scrim` | all | 1 | ✅ matched | shorts 1 |
| `yt.watch.hideAmbientMode` | `cinematic-container-view-model` | all | 2 | ✅ matched | playlist 2 |
| `yt.player.hideEndscreenCards` | `.ytp-ce-element` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideEndscreenWall` | `.html5-endscreen` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideEndscreenWall` | `.ytp-endscreen-content` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideEndscreenWall` | `.ytp-fullscreen-grid` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.player.hideInfoCards` | `.ytp-cards-button` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideInfoCards` | `.ytp-cards-teaser` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hidePauseOverlay` | `.ytp-pause-overlay` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hidePauseOverlay` | `.ytp-pause-overlay-container` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideWatermark` | `.iv-branding` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideWatermark` | `.ytp-watermark` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hidePaidPromotion` | `.ytp-paid-content-overlay` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hidePaidPromotion` | `.YtmPaidContentOverlayHost` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideAutoplayToggle` | `.ytp-autonav-toggle` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.player.hideAutoplayToggle` | `button.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.player.hideNextButton` | `.ytp-next-button` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideMiniplayerButton` | `.ytp-miniplayer-button` | all | 0 | ⚠️ 0 matches |  |
| `yt.player.hideCastButton` | `.ytp-remote-button` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideSubtitlesButton` | `.ytp-subtitles-button` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideChapterTitle` | `.ytp-chapter-container` | all | 46 | ✅ matched | channel-home-lofigirl 4, channel-home-ltt 4, channel-home 4 |
| `yt.player.hideProgressPreviews` | `.ytp-tooltip-image` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideProgressPreviews` | `.ytp-storyboard-framepreview` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.player.hideProgressPreviews` | `.ytp-tooltip-bg` | all | 23 | ✅ matched | channel-home-lofigirl 2, channel-home-ltt 2, channel-home 2 |
| `yt.comments.hideAll` | `ytd-comments#comments` | all | 20 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.comments.hideAll` | `ytd-watch-flexy ytd-comments` | all | 23 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.comments.hideAll` | `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` | all | 4 | ✅ matched | shorts 1, watch-chapters 1, watch-music 1 |
| `yt.comments.hideAll` | `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)` | all | 1 | ✅ matched | shorts 1 |
| `yt.comments.hideAll` | `ytd-reel-player-overlay-renderer #comments-button` | all | 0 | ⚠️ 0 matches |  |
| `yt.comments.hideTeaser` | `ytd-watch-flexy #comment-teaser` | watch | 4 | ✅ matched | watch-chapters 1, watch-live 1, watch-music 1 |
| `yt.comments.hideCount` | `ytd-comments-header-renderer #count` | all | 4 | ✅ matched | channel-posts 1, watch-chapters 1, watch-music 1 |
| `yt.comments.hideCount` | `ytd-comments-header-renderer yt-formatted-string.count-text` | all | 4 | ✅ matched | channel-posts 1, watch-chapters 1, watch-music 1 |
| `yt.comments.hideAvatars` | `ytd-comments ytd-comment-view-model #author-thumbnail` | all | 60 | ✅ matched | watch-chapters 20, watch-music 20, watch-playlist 20 |
| `yt.comments.hideAvatars` | `ytd-comments ytd-comment-simplebox-renderer #author-thumbnail` | all | 3 | ✅ matched | watch-chapters 1, watch-music 1, watch-playlist 1 |
| `yt.comments.hideAvatars` | `ytd-comments ytd-comment-renderer #author-thumbnail` | all | 0 | ⚠️ 0 matches |  |
| `yt.comments.hideLikeCounts` | `ytd-comment-engagement-bar #vote-count-middle` | all | 60 | ✅ matched | watch-chapters 20, watch-music 20, watch-playlist 20 |
| `yt.comments.hideLikeCounts` | `ytd-comments #vote-count-middle` | all | 60 | ✅ matched | watch-chapters 20, watch-music 20, watch-playlist 20 |
| `yt.comments.hideReplies` | `ytd-comment-thread-renderer #replies` | all | 60 | ✅ matched | watch-chapters 20, watch-music 20, watch-playlist 20 |
| `yt.comments.hideReplies` | `ytd-comment-replies-renderer` | all | 33 | ✅ matched | watch-chapters 12, watch-music 17, watch-playlist 4 |
| `yt.comments.hideCreatorHearts` | `ytd-comment-engagement-bar #creator-heart` | all | 60 | ✅ matched | watch-chapters 20, watch-music 20, watch-playlist 20 |
| `yt.comments.hideCreatorHearts` | `ytd-creator-heart-renderer` | all | 3 | ✅ matched | watch-playlist 3 |
| `yt.search.hideShorts` | `ytd-search grid-shelf-view-model:has(ytm-shorts-lockup-view-model)` | search | 7 | ✅ matched | search-lofi 3, search-mrbeast 1, search-rice 3 |
| `yt.search.hideShorts` | `ytd-search grid-shelf-view-model:has(a[href^="/shorts/"])` | search | 7 | ✅ matched | search-lofi 3, search-mrbeast 1, search-rice 3 |
| `yt.search.hideShorts` | `ytd-search ytd-reel-shelf-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideShorts` | `ytd-search ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` | search | 12 | ✅ matched | search-mrbeast 12 |
| `yt.search.hideShorts` | `ytd-search ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])` | search | 12 | ✅ matched | search-mrbeast 12 |
| `yt.search.hideShelves` | `ytd-search ytd-shelf-renderer` | search | 2 | ✅ matched | search-lofi 1, search-mrbeast 1 |
| `yt.search.hideRelatedSearches` | `ytd-search ytd-search-refinement-card-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideRelatedSearches` | `ytd-search ytd-horizontal-card-list-renderer:has(ytd-search-refinement-card-renderer)` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAds` | `ytd-search ytd-ad-slot-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAds` | `ytd-search ytd-search-pyv-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAds` | `ytd-search ytd-promoted-sparkles-web-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAds` | `ytd-search ytd-promoted-video-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAds` | `ytd-search ytd-in-feed-ad-layout-renderer` | search | 0 | ⚠️ 0 matches |  |
| `yt.search.hideAISummary` | `ytd-search ytd-expandable-metadata-renderer:has(video-summary-content-view-model)` | search | 1 | ✅ matched | search-rice 1 |
| `yt.search.hideAISummary` | `ytd-search ytd-video-renderer #expandable-metadata:has(video-summary-content-view-model)` | search | 1 | ✅ matched | search-rice 1 |
| `yt.search.hideAISummary` | `ytd-search video-summary-content-view-model` | search | 1 | ✅ matched | search-rice 1 |
| `yt.search.hideChannelResults` | `ytd-search ytd-channel-renderer` | search | 3 | ✅ matched | search-lofi 1, search-mrbeast 2 |
| `yt.search.hideSnippets` | `ytd-search ytd-video-renderer .metadata-snippet-container` | search | 31 | ✅ matched | search-lofi 13, search-mrbeast 13, search-rice 5 |
| `yt.search.hideSnippets` | `ytd-search ytd-video-renderer .metadata-snippet-container-one-line` | search | 20 | ✅ matched | search-lofi 8, search-mrbeast 1, search-rice 11 |
| `yt.search.hideSnippets` | `ytd-search ytd-video-renderer #description-text` | search | 56 | ✅ matched | search-lofi 21, search-mrbeast 20, search-rice 15 |
| `yt.search.hideSnippets` | `ytd-search ytd-channel-renderer #description` | search | 3 | ✅ matched | search-lofi 1, search-mrbeast 2 |
| `yt.search.hideFilterChips` | `ytd-search ytd-search-header-renderer #chip-bar` | search | 3 | ✅ matched | search-lofi 1, search-mrbeast 1, search-rice 1 |
| `yt.search.hideFilterChips` | `ytd-search ytd-search-header-renderer yt-chip-cloud-renderer` | search | 2 | ✅ matched | search-lofi 1, search-rice 1 |
| `yt.shorts.mode=watch` | `ytd-shorts` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.mode=block` | `ytd-shorts` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideComments` | `ytd-shorts ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideComments` | `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideComments` | `ytd-reel-player-overlay-renderer #comments-button` | shorts | 0 | ⚠️ 0 matches |  |
| `yt.shorts.hideLikeCounts` | `ytd-shorts reel-action-bar-view-model like-button-view-model .ytSpecButtonShapeWithLabelLabel` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideLikeCounts` | `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1) .ytSpecButtonShapeWithLabelLabel` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideRemix` | `ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(3)` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideRemix` | `ytd-reel-player-overlay-renderer #remix-button` | shorts | 0 | ⚠️ 0 matches |  |
| `yt.shorts.hideSubscribe` | `ytd-shorts yt-reel-channel-bar-view-model .ytReelChannelBarViewModelReelSubscribeButton` | shorts | 1 | ✅ matched | shorts 1 |
| `yt.shorts.hideSubscribe` | `ytd-reel-player-overlay-renderer #subscribe-button` | shorts | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-reel-shelf-renderer` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(a[href^="/shorts/"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideShorts` | `ytd-browse[page-subtype="subscriptions"] ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hidePosts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hidePosts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hidePosts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer[is-post]` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hidePosts` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-post-renderer)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideLive` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailLive)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideLive` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeLive)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideLive` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideLive` | `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideUpcoming` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(badge-shape.ytBadgeShapeThumbnailUpcoming)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideUpcoming` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideUpcoming` | `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="UPCOMING"])` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideWatched` | `ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideWatched` | `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.subs.hideWatched` | `ytd-browse[page-subtype="subscriptions"] ytd-video-renderer:has(yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer)` | subscriptions | 0 | ⚠️ 0 matches |  |
| `yt.channel.hideTrailer` | `ytd-browse[page-subtype="channels"] ytd-item-section-renderer:has(> #contents > ytd-channel-video-player-renderer)` | channel | 3 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideTrailer` | `ytd-browse[page-subtype="channels"] ytd-channel-video-player-renderer` | channel | 3 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideHomeShelves` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > :is(ytd-shelf-renderer, ytd-channel-video-player-…` | channel | 23 | ✅ matched | channel-home-lofigirl 6, channel-home-ltt 12, channel-home 5 |
| `yt.channel.hideRowShorts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="shorts"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowShorts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="shorts"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowShorts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > ytd-reel-shelf-renderer)` | channel | 1 | ✅ matched | channel-home-ltt 1 |
| `yt.channel.hideRowShorts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-reel-shelf-renderer` | channel | 1 | ✅ matched | channel-home-ltt 1 |
| `yt.channel.hideRowPosts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="posts"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowPosts` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="posts"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowMembers` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="members"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowMembers` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="members"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowLive` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="live"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowLive` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="live"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowPopular` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="popular"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowPopular` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="popular"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowPlaylists` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="playlists"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowPlaylists` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="playlists"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowChannels` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) ytd-item-section-renderer:has(> #contents > [data-at-peace-shelf="channels"])` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideRowChannels` | `ytd-browse[page-subtype="channels"]:has(yt-tab-group-shape [role="tablist"] > yt-tab-shape:first-child[aria-selected="true"]) [data-at-peace-shelf="channels"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideBanner` | `ytd-browse[page-subtype="channels"] #page-header-banner` | channel | 6 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideBanner` | `ytd-browse[page-subtype="channels"] yt-image-banner-view-model` | channel | 6 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideBanner` | `ytd-browse[page-subtype="channels"] .page-header-banner` | channel | 0 | ⚠️ 0 matches |  |
| `yt.channel.hideJoinButton` | `ytd-browse[page-subtype="channels"] [data-at-peace-channel-action="join"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideSubscriberCount` | `ytd-browse[page-subtype="channels"] .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataText:has(+ .ytContentMetadataViewModelDelimiter + .ytContentMetadataViewModelMetadataText:nth-last-child(1 of …` | channel | 6 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideSubscriberCount` | `ytd-browse[page-subtype="channels"] .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataText:has(+ .ytContentMetadataViewModelDelimiter + .ytContentMetadataViewModelMetadataText:nth-last-child(1 of …` | channel | 6 | ✅ matched | channel-home-lofigirl 1, channel-home-ltt 1, channel-home 1 |
| `yt.channel.hideShortsTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="shorts"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideLiveTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="streams"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hidePodcastsTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="podcasts"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hidePlaylistsTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="playlists"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hidePostsTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="posts"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideStoreTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="store"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideShowsTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="shows"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideCoursesTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="courses"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideMembersTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="members"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |
| `yt.channel.hideReleasesTab` | `ytd-browse[page-subtype="channels"] yt-tab-shape[data-at-peace-tab="releases"]` | channel | 0 | ⚠️ 0 matches | set by the page bridge at runtime |

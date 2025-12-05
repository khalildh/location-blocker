# X Location Blocker

A Chrome extension that blocks X (Twitter) accounts based on their **account registration country** — the "Account based in" field shown on user profile about pages.

## Why?

X shows where accounts are registered (based on signup IP/phone), but doesn't let you filter your feed by this. This extension fills that gap, letting you curate your timeline based on account origin.

## How It Works

1. As you scroll your timeline, the extension detects tweets
2. For each user, it opens their `/about` page in a background tab
3. Extracts the "Account based in [Country]" text
4. Caches the result and closes the tab
5. If the country matches your blocked list, the tweet is hidden with an overlay

## Features

- **Block by country**: Add countries to your block list
- **Visual overlay**: Blocked tweets are dimmed with an option to "Show Tweet"
- **Cataloged users**: See all discovered users grouped by country
- **One-click blocking**: Block/unblock countries directly from the user list
- **Search**: Filter cataloged users by name or country
- **Pause fetching**: Toggle auto-fetch to control when background tabs open
- **Persistent cache**: User countries are saved, so repeat visits don't re-fetch

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. Navigate to X/Twitter and click the extension icon

## Usage

1. **Enable Blocking**: Toggle on to start filtering tweets
2. **Auto-fetch Locations**: Toggle off to pause background tab fetching
3. **Add locations**: Type a country name and click Add
4. **Quick block**: In the Cataloged Users section, click "Block" next to any country

## Permissions

- `storage`: Save settings and cached user data
- `tabs`: Open background tabs to fetch user about pages

## Limitations

- Only works when logged into X
- Rate limited to 2 concurrent tab fetches to avoid overwhelming X
- Some users may not have "Account based in" visible

## Repository

https://github.com/khalildh/location-blocker

## License

MIT

// Location Blocker - Content Script
const LOG_PREFIX = '🛡️ [Location Blocker]';

let isEnabled = false;
let isFetchingEnabled = true; // Whether to auto-fetch locations via new tabs
let blockedLocations = [];
let processedTweets = new WeakSet();
let userCountryCache = {}; // Cache for user country data

// Logging utility
function log(message, data = null) {
    if (data !== null) {
        console.log(`${LOG_PREFIX} ${message}`, data);
    } else {
        console.log(`${LOG_PREFIX} ${message}`);
    }
}

function logWarn(message, data = null) {
    if (data !== null) {
        console.warn(`${LOG_PREFIX} ${message}`, data);
    } else {
        console.warn(`${LOG_PREFIX} ${message}`);
    }
}

function logError(message, data = null) {
    if (data !== null) {
        console.error(`${LOG_PREFIX} ${message}`, data);
    } else {
        console.error(`${LOG_PREFIX} ${message}`);
    }
}

// Check if we're on an /about page
const currentPath = window.location.pathname;
const isAboutPage = currentPath.endsWith('/about') || currentPath.includes('/about');

if (isAboutPage) {
    // === ABOUT PAGE MODE ===
    // Extract country data and send to background script
    log('Detected /about page, will extract country data');
    log('Current path:', currentPath);

    let retryCount = 0;
    const maxRetries = 15; // 15 retries * 500ms = 7.5 seconds max

    function extractCountryData() {
        retryCount++;
        const pageText = document.body.innerText;

        // Log first 500 chars of page text for debugging
        if (retryCount === 1) {
            log('Page text sample:', pageText.substring(0, 500));
        }

        // Try multiple patterns
        let country = null;

        // Pattern 1: "Account based in [Country]"
        const match1 = pageText.match(/Account based in\s+([^\n]+)/i);
        if (match1 && match1[1]) {
            country = match1[1].trim();
        }

        // Pattern 2: Look for country after date joined
        if (!country) {
            const match2 = pageText.match(/Date joined.*?Account based in\s+([^\n]+)/is);
            if (match2 && match2[1]) {
                country = match2[1].trim();
            }
        }

        if (country) {
            log(`Extracted country: "${country}" (attempt ${retryCount})`);

            chrome.runtime.sendMessage({
                action: 'countryDataExtracted',
                country: country
            });
        } else if (retryCount < maxRetries) {
            log(`Country data not found yet, retry ${retryCount}/${maxRetries}...`);
            setTimeout(extractCountryData, 500);
        } else {
            log('Max retries reached, no country found');
            log('Final page text sample:', pageText.substring(0, 1000));
            // Send null so we don't timeout
            chrome.runtime.sendMessage({
                action: 'countryDataExtracted',
                country: null
            });
        }
    }

    // Start extraction after page loads
    if (document.readyState === 'complete') {
        setTimeout(extractCountryData, 1500);
    } else {
        window.addEventListener('load', () => {
            setTimeout(extractCountryData, 1500);
        });
    }

} else {
    // === TIMELINE MODE ===
    // Main content script logic for timeline/feed pages
    log('Content script loaded on timeline');

    // Initialize settings and load cached country data
    chrome.storage.local.get(['enabled', 'fetchingEnabled', 'blockedLocations', 'userCountryCache'], function(result) {
        isEnabled = result.enabled || false;
        isFetchingEnabled = result.fetchingEnabled !== false; // Default to true
        blockedLocations = result.blockedLocations || [];
        userCountryCache = result.userCountryCache || {};
        log('Initialized with settings:', { isEnabled, isFetchingEnabled, blockedLocations, cachedUsers: Object.keys(userCountryCache).length });
        if (isEnabled) {
            initializeObserver();
            processExistingTweets();
        }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        log('Received message:', request);
        if (request.action === 'toggleFilter') {
            isEnabled = request.enabled;
            log(`Filter ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
            if (isEnabled) {
                initializeObserver();
                processExistingTweets();
            } else {
                removeAllOverlays();
            }
        } else if (request.action === 'toggleFetching') {
            isFetchingEnabled = request.enabled;
            log(`Auto-fetch ${isFetchingEnabled ? 'ENABLED' : 'PAUSED'}`);
        } else if (request.action === 'updateLocations') {
            blockedLocations = request.locations;
            log('Blocked locations updated:', blockedLocations);
            if (isEnabled) {
                removeAllOverlays();
                processedTweets = new WeakSet();
                processExistingTweets();
            }
        }
    });
}

// === SHARED FUNCTIONS ===

function initializeObserver() {
    log('Initializing MutationObserver');
    const observer = new MutationObserver((mutations) => {
        if (!isEnabled) return;

        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    const tweets = node.querySelectorAll('article[data-testid="tweet"]');
                    if (tweets.length > 0) {
                        log(`Found ${tweets.length} new tweet(s) in DOM mutation`);
                    }
                    tweets.forEach(processTweet);

                    if (node.matches && node.matches('article[data-testid="tweet"]')) {
                        processTweet(node);
                    }
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    log('MutationObserver active');
}

function processExistingTweets() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    log(`Processing ${tweets.length} existing tweet(s)`);
    tweets.forEach(processTweet);
}

function removeAllOverlays() {
    const overlays = document.querySelectorAll('.location-blocker-overlay');
    const badges = document.querySelectorAll('.location-blocker-badge');
    log(`Removing ${overlays.length} overlay(s) and ${badges.length} badge(s)`);
    overlays.forEach(el => el.remove());
    badges.forEach(el => el.remove());
    document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        tweet.style.opacity = '';
        tweet.style.position = '';
    });
}

async function processTweet(tweet) {
    if (processedTweets.has(tweet) || !isEnabled) return;
    processedTweets.add(tweet);

    const username = extractUsername(tweet);
    if (!username) {
        logWarn('Could not extract username from tweet');
        return;
    }

    log(`Processing tweet from @${username}`);

    // Get location data
    const country = await getCountryForUser(username);

    if (country) {
        log(`@${username}: Country = "${country}"`);

        if (isLocationBlocked(country)) {
            log(`🚫 @${username}: BLOCKED - Country "${country}" matches blocked list`);
            applyFilter(tweet, country);
        } else {
            log(`✅ @${username}: ALLOWED - Country "${country}" not in blocked list`);
        }
    } else {
        log(`@${username}: No country found`);
    }
}

function extractUsername(tweet) {
    const userLinks = tweet.querySelectorAll('a[href^="/"]');
    for (const link of userLinks) {
        const href = link.getAttribute('href');
        if (href && /^\/[a-zA-Z0-9_]+$/.test(href)) {
            return href.substring(1);
        }
    }
    return null;
}

// Save country cache to storage for popup display
function saveCountryCacheToStorage() {
    chrome.storage.local.set({ userCountryCache: userCountryCache });
}

// Get country by asking background script to open the about page
async function getCountryForUser(username) {
    // Check cache first
    if (userCountryCache[username.toLowerCase()]) {
        const cached = userCountryCache[username.toLowerCase()];
        log(`@${username}: Found in cache: ${cached}`);
        return cached;
    }

    // If fetching is disabled, skip
    if (!isFetchingEnabled) {
        log(`@${username}: Auto-fetch disabled, skipping`);
        return null;
    }

    log(`@${username}: Requesting country via background script...`);

    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { action: 'getCountryForUser', username: username },
            function(response) {
                if (response && response.country) {
                    log(`@${username}: Got country from background: ${response.country}`);
                    userCountryCache[username.toLowerCase()] = response.country;
                    saveCountryCacheToStorage(); // Save to storage for popup
                    resolve(response.country);
                } else {
                    log(`@${username}: No country returned from background`, response);
                    resolve(null);
                }
            }
        );
    });
}

function isLocationBlocked(location) {
    if (!location || blockedLocations.length === 0) return false;

    const locationLower = location.toLowerCase();
    const matchedLocation = blockedLocations.find(blocked => {
        const blockedLower = blocked.toLowerCase();
        return locationLower.includes(blockedLower) || blockedLower.includes(locationLower);
    });

    if (matchedLocation) {
        log(`Location match: "${location}" matched blocked entry "${matchedLocation}"`);
    }

    return !!matchedLocation;
}

function applyFilter(tweet, location) {
    tweet.style.position = 'relative';
    tweet.style.opacity = '0.3';

    const badge = document.createElement('div');
    badge.className = 'location-blocker-badge';
    badge.textContent = `📍 ${location}`;
    tweet.appendChild(badge);

    const overlay = document.createElement('div');
    overlay.className = 'location-blocker-overlay';

    const content = document.createElement('div');
    content.className = 'location-blocker-content';
    content.innerHTML = `
        <p>🚫 Blocked Location</p>
        <small>${location}</small>
        <button class="location-blocker-show-btn">Show Tweet</button>
    `;

    overlay.appendChild(content);
    tweet.appendChild(overlay);

    const showBtn = overlay.querySelector('.location-blocker-show-btn');
    showBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        log(`User clicked "Show Tweet" for blocked location: ${location}`);
        overlay.remove();
        badge.remove();
        tweet.style.opacity = '1';
    });
}

// Log status periodically (every 30 seconds)
setInterval(() => {
    if (isEnabled) {
        log(`📊 Status: Filter enabled, blocking [${blockedLocations.join(', ')}]`);
    }
}, 30000);

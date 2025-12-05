// Background service worker for Location Blocker
const LOG_PREFIX = '🛡️ [Location Blocker BG]';

function log(message, data = null) {
    if (data !== null) {
        console.log(`${LOG_PREFIX} ${message}`, data);
    } else {
        console.log(`${LOG_PREFIX} ${message}`);
    }
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            enabled: false,
            blockedLocations: [],
            blockedCount: 0
        });
    }
});

// Track pending country requests
const pendingRequests = {};

// Queue system to limit concurrent tab requests
const MAX_CONCURRENT = 2; // Only 2 tabs at a time
let activeRequests = 0;
const requestQueue = [];

function processQueue() {
    while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
        const { username, sendResponse } = requestQueue.shift();
        activeRequests++;
        log(`Processing queue: @${username} (active: ${activeRequests}, queued: ${requestQueue.length})`);
        openAboutTab(username, sendResponse);
    }
}

function openAboutTab(username, sendResponse) {
    chrome.tabs.create({
        url: `https://x.com/${username}/about`,
        active: false
    }, function(tab) {
        if (chrome.runtime.lastError) {
            log(`Error creating tab for @${username}:`, chrome.runtime.lastError.message);
            activeRequests--;
            sendResponse({ country: null, error: 'tab_error' });
            processQueue();
            return;
        }

        log(`Opened tab ${tab.id} for @${username}`);

        pendingRequests[tab.id] = {
            username: username,
            sendResponse: sendResponse,
            timeoutId: setTimeout(() => {
                log(`Timeout waiting for country data for @${username}`);
                chrome.tabs.remove(tab.id).catch(() => {});
                delete pendingRequests[tab.id];
                activeRequests--;
                sendResponse({ country: null, error: 'timeout' });
                processQueue();
            }, 15000) // 15 second timeout
        };
    });
}

// Listen for messages
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'incrementBlockedCount') {
        chrome.storage.local.get(['blockedCount'], function(result) {
            const newCount = (result.blockedCount || 0) + 1;
            chrome.storage.local.set({ blockedCount: newCount });
        });
    }

    if (request.action === 'getCountryForUser') {
        const username = request.username;
        log(`Request to get country for @${username} (queued: ${requestQueue.length}, active: ${activeRequests})`);

        // Add to queue
        requestQueue.push({ username, sendResponse });
        processQueue();

        // Return true to indicate we'll respond asynchronously
        return true;
    }

    if (request.action === 'countryDataExtracted') {
        // This comes from the content script running on the about page
        const tabId = sender.tab.id;
        const pending = pendingRequests[tabId];

        log(`Received countryDataExtracted from tab ${tabId}:`, request);

        if (pending) {
            log(`Received country data for @${pending.username}: ${request.country}`);
            clearTimeout(pending.timeoutId);
            pending.sendResponse({ country: request.country });
            delete pendingRequests[tabId];

            // Close the tab and process next in queue
            chrome.tabs.remove(tabId).catch(() => {});
            activeRequests--;
            processQueue();
        } else {
            log(`No pending request found for tab ${tabId}`);
            // Still close the tab if it's an about page we opened
            chrome.tabs.remove(tabId).catch(() => {});
        }
    }
});

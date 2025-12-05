document.addEventListener('DOMContentLoaded', function() {
    const enableFilter = document.getElementById('enableFilter');
    const enableFetching = document.getElementById('enableFetching');
    const queueStatus = document.getElementById('queueStatus');
    const newLocationInput = document.getElementById('newLocation');
    const addLocationBtn = document.getElementById('addLocation');
    const locationList = document.getElementById('locationList');
    const emptyHint = document.getElementById('emptyHint');
    const blockedCount = document.getElementById('blockedCount');
    const usersList = document.getElementById('usersList');
    const usersEmptyHint = document.getElementById('usersEmptyHint');
    const usersCount = document.getElementById('usersCount');
    const userSearch = document.getElementById('userSearch');
    const clearCacheBtn = document.getElementById('clearCache');

    let allUsers = {}; // Store all users for filtering
    let blockedLocations = []; // Track blocked locations

    // Load saved settings
    chrome.storage.local.get(['enabled', 'fetchingEnabled', 'blockedLocations', 'blockedCount', 'userCountryCache'], function(result) {
        enableFilter.checked = result.enabled || false;
        enableFetching.checked = result.fetchingEnabled !== false; // Default to true
        blockedLocations = result.blockedLocations || [];
        renderLocations(blockedLocations);
        blockedCount.textContent = result.blockedCount || 0;
        allUsers = result.userCountryCache || {};
        renderUsers(allUsers);
        updateQueueStatus();
    });

    // Toggle filter
    enableFilter.addEventListener('change', function() {
        const enabled = enableFilter.checked;
        chrome.storage.local.set({ enabled: enabled }, function() {
            sendMessageToActiveTab({ action: 'toggleFilter', enabled: enabled });
        });
    });

    // Toggle fetching
    enableFetching.addEventListener('change', function() {
        const enabled = enableFetching.checked;
        chrome.storage.local.set({ fetchingEnabled: enabled }, function() {
            sendMessageToActiveTab({ action: 'toggleFetching', enabled: enabled });
            updateQueueStatus();
        });
    });

    // Update queue status display
    function updateQueueStatus() {
        if (!enableFetching.checked) {
            queueStatus.textContent = '(paused)';
            queueStatus.className = 'toggle-hint paused';
        } else {
            queueStatus.textContent = '(active)';
            queueStatus.className = 'toggle-hint active';
        }
    }

    // Add location
    addLocationBtn.addEventListener('click', addLocation);
    newLocationInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addLocation();
        }
    });

    function addLocation() {
        const location = newLocationInput.value.trim();
        if (!location) return;

        // Check for duplicates (case-insensitive)
        if (blockedLocations.some(l => l.toLowerCase() === location.toLowerCase())) {
            showNotification('Location already blocked', 'error');
            return;
        }

        blockedLocations.push(location);
        chrome.storage.local.set({ blockedLocations: blockedLocations }, function() {
            renderLocations(blockedLocations);
            renderUsers(allUsers); // Re-render to update block buttons
            newLocationInput.value = '';
            sendMessageToActiveTab({ action: 'updateLocations', locations: blockedLocations });
            showNotification('Location added');
        });
    }

    function removeLocation(locationToRemove) {
        blockedLocations = blockedLocations.filter(l => l !== locationToRemove);
        chrome.storage.local.set({ blockedLocations: blockedLocations }, function() {
            renderLocations(blockedLocations);
            renderUsers(allUsers); // Re-render to update block buttons
            sendMessageToActiveTab({ action: 'updateLocations', locations: blockedLocations });
            showNotification('Location removed');
        });
    }

    function renderLocations(locations) {
        locationList.innerHTML = '';

        if (locations.length === 0) {
            emptyHint.classList.remove('hidden');
        } else {
            emptyHint.classList.add('hidden');
            locations.forEach(location => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span>📍 ${escapeHtml(location)}</span>
                    <button title="Remove">&times;</button>
                `;
                li.querySelector('button').addEventListener('click', () => removeLocation(location));
                locationList.appendChild(li);
            });
        }
    }

    function sendMessageToActiveTab(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0] && (tabs[0].url.includes('twitter.com') || tabs[0].url.includes('x.com'))) {
                chrome.tabs.sendMessage(tabs[0].id, message);
            }
        });
    }

    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#f4212e' : '#00ba7c'};
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            z-index: 1000;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // User search filter
    userSearch.addEventListener('input', function() {
        const searchTerm = userSearch.value.toLowerCase();
        const filtered = {};
        for (const [username, country] of Object.entries(allUsers)) {
            if (username.toLowerCase().includes(searchTerm) ||
                country.toLowerCase().includes(searchTerm)) {
                filtered[username] = country;
            }
        }
        renderUsers(filtered, searchTerm !== '');
    });

    // Clear cache button
    clearCacheBtn.addEventListener('click', function() {
        if (confirm('Clear all cached user data?')) {
            chrome.storage.local.set({ userCountryCache: {} }, function() {
                allUsers = {};
                renderUsers({});
                showNotification('Cache cleared');
            });
        }
    });

    // Toggle block/unblock a country from the cataloged users section
    function toggleBlockCountry(country, isCurrentlyBlocked) {
        if (isCurrentlyBlocked) {
            // Remove from blocked list
            blockedLocations = blockedLocations.filter(l =>
                l.toLowerCase() !== country.toLowerCase()
            );
            showNotification(`Unblocked ${country}`);
        } else {
            // Add to blocked list
            blockedLocations.push(country);
            showNotification(`Blocked ${country}`);
        }

        chrome.storage.local.set({ blockedLocations: blockedLocations }, function() {
            renderLocations(blockedLocations);
            renderUsers(allUsers);
            sendMessageToActiveTab({ action: 'updateLocations', locations: blockedLocations });
        });
    }

    function renderUsers(users, isFiltered = false) {
        usersList.innerHTML = '';
        const entries = Object.entries(users);

        if (entries.length === 0) {
            usersEmptyHint.classList.remove('hidden');
            usersEmptyHint.textContent = isFiltered ? 'No matching users' : 'No users cataloged yet';
            usersCount.textContent = '';
        } else {
            usersEmptyHint.classList.add('hidden');

            // Sort by username
            entries.sort((a, b) => a[0].localeCompare(b[0]));

            // Group by country
            const byCountry = {};
            entries.forEach(([username, country]) => {
                if (!byCountry[country]) {
                    byCountry[country] = [];
                }
                byCountry[country].push(username);
            });

            // Sort countries by user count (descending)
            const sortedCountries = Object.keys(byCountry).sort((a, b) =>
                byCountry[b].length - byCountry[a].length
            );

            sortedCountries.forEach(country => {
                const countryDiv = document.createElement('div');
                countryDiv.className = 'country-group';

                // Check if this country is blocked
                const isBlocked = blockedLocations.some(blocked =>
                    blocked.toLowerCase() === country.toLowerCase() ||
                    country.toLowerCase().includes(blocked.toLowerCase()) ||
                    blocked.toLowerCase().includes(country.toLowerCase())
                );

                const header = document.createElement('div');
                header.className = 'country-header';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'country-name';
                nameSpan.textContent = `📍 ${country}`;

                const rightSection = document.createElement('div');
                rightSection.className = 'country-header-right';

                const countSpan = document.createElement('span');
                countSpan.className = 'country-count';
                countSpan.textContent = byCountry[country].length;

                const blockBtn = document.createElement('button');
                blockBtn.className = isBlocked ? 'block-btn blocked' : 'block-btn';
                blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
                blockBtn.addEventListener('click', () => toggleBlockCountry(country, isBlocked));

                rightSection.appendChild(countSpan);
                rightSection.appendChild(blockBtn);
                header.appendChild(nameSpan);
                header.appendChild(rightSection);
                countryDiv.appendChild(header);

                const usersDiv = document.createElement('div');
                usersDiv.className = 'country-users';
                byCountry[country].forEach(username => {
                    const userSpan = document.createElement('a');
                    userSpan.className = 'user-tag';
                    userSpan.href = `https://x.com/${username}`;
                    userSpan.target = '_blank';
                    userSpan.textContent = `@${username}`;
                    usersDiv.appendChild(userSpan);
                });
                countryDiv.appendChild(usersDiv);

                usersList.appendChild(countryDiv);
            });

            const totalUsers = Object.keys(allUsers).length;
            const showing = entries.length;
            usersCount.textContent = isFiltered
                ? `Showing ${showing} of ${totalUsers} users`
                : `${totalUsers} users cataloged`;
        }
    }
});

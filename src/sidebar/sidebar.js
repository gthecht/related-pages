console.log('Sidebar script loaded');

// Request initial related tabs when sidebar loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Sidebar DOM loaded');
    const linksList = document.getElementById('relatedLinks');
    linksList.innerHTML = '<li>Loading...</li>';
    
    browser.runtime.sendMessage({
        type: 'getRelatedTabs'
    }).then(response => {
        if (!response || !response.success) {
            console.warn('Failed to get related tabs:', response?.error);
            linksList.innerHTML = '<li class="empty-state">No related tabs yet - start browsing!</li>';
        } else {
            console.log('Successfully requested related tabs');
        }
    }).catch(error => {
        console.error('Error requesting related tabs:', error);
        linksList.innerHTML = '<li class="error-state">Error loading tabs</li>';
    });
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message in sidebar:', message);
    if (message.type === 'updateRelatedLinks') {
        updateRelatedLinks(message);
    }
    // Always return true to indicate async response
    return true;
});

let currentUrl = '';

// Update the sidebar with related links
function updateRelatedLinks(message) {
    currentUrl = message.url;
    if (!message || !message.links) {
        console.error('Invalid message received:', message);
        return;
    }
    const links = message.links;
    console.log('Received links update:', message);
    const linksList = document.getElementById('relatedLinks');
    if (!linksList) {
        console.error('Related links element not found');
        return;
    }
    linksList.innerHTML = '';

    if (!Array.isArray(links) || links.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-state';
        li.textContent = 'No related tabs for this page yet';
        linksList.appendChild(li);
        return;
    }

    links.forEach(link => {
        if (typeof link === 'object' && link.url) {  // Ensure we have a valid link object
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = link.url;
            
            // Add favicon with multiple fallback options
            const favicon = document.createElement('img');
            favicon.className = 'favicon';
            
            // Set favicon from stored info or try fallback sources
            if (link.favicon) {
                favicon.src = link.favicon;
            } else {
                // Try different favicon sources
                const tryFaviconSources = async (favicon, url) => {
                    const sources = [
                        `${new URL(url).origin}/favicon.ico`,
                        `${new URL(url).origin}/favicon.png`,
                        `${new URL(url).origin}/apple-touch-icon.png`,
                        'chrome://favicon/size/16@1x/' + url,
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ccc" width="100" height="100"/></svg>'
                    ];
                    
                    for (const source of sources) {
                        try {
                            await new Promise((resolve, reject) => {
                                favicon.onload = resolve;
                                favicon.onerror = reject;
                                favicon.src = source;
                            });
                            return; // If successful, exit
                        } catch (e) {
                            continue; // Try next source
                        }
                    }
                };
                
                tryFaviconSources(favicon, link.url);
            }
            
            // Function to format a path segment into a readable title
            const formatPathSegment = (segment) => {
                try {
                    return decodeURIComponent(segment)
                        .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
                        .replace(/\.\w+$/, '') // Remove file extensions
                        .replace(/^\d+[.-]/, '') // Remove leading numbers and separators
                        .replace(/[A-F0-9]{8}(?:[A-F0-9]{4}){3}[A-F0-9]{12}/i, '') // Remove GUIDs
                        .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/, '') // Remove dates
                        .trim()
                        .split(' ')
                        .filter(Boolean)
                        .join(' ');
                } catch (e) {
                    return segment;
                }
            };

            // Generate display title
            let displayTitle;
            if (link.title && !link.title.includes('://') && !link.title.includes('/') && !link.title.startsWith('www.')) {
                // Use existing title if it doesn't look like a URL
                displayTitle = link.title;
            } else {
                try {
                    const urlObj = new URL(link.url);
                    const pathParts = urlObj.pathname.split('/').filter(Boolean);
                    
                    if (pathParts.length > 0) {
                        // Take up to last 3 meaningful segments
                        const significantParts = pathParts
                            .slice(-3)
                            .map(formatPathSegment)
                            .filter(part => part.length > 0);
                            
                        // If we have a fragment, add it to the parts
                        if (urlObj.hash) {
                            const fragment = formatPathSegment(urlObj.hash.substring(1)); // Remove the leading #
                            if (fragment) {
                                significantParts.push(fragment);
                            }
                        }
                            
                        // If we have meaningful path parts, use them
                        if (significantParts.length > 0) {
                            displayTitle = significantParts.join(' › ');
                        } else {
                            // Try to use query parameters if path parts aren't meaningful
                            const params = new URLSearchParams(urlObj.search);
                            const titleParams = ['title', 'name', 'q', 'query', 'id'];
                            for (const param of titleParams) {
                                const value = params.get(param);
                                if (value) {
                                    displayTitle = formatPathSegment(value);
                                    break;
                                }
                            }
                            // Fall back to hostname if no meaningful query params
                            if (!displayTitle) {
                                displayTitle = urlObj.hostname.replace(/^www\./, '');
                            }
                        }
                    } else {
                        displayTitle = urlObj.hostname.replace(/^www\./, '');
                    }
                } catch (e) {
                    displayTitle = link.title || link.url;
                }
            }
            const titleSpan = document.createElement('span');
            titleSpan.textContent = displayTitle.replace(/^\d+\s*-\s*/, '').trim();
            titleSpan.title = link.url; // Show full URL on hover
            
            a.appendChild(favicon);
            a.appendChild(titleSpan);
            a.addEventListener('click', async (e) => {
                e.preventDefault();
                // Get all tabs and find one with matching URL
                const allTabs = await browser.tabs.query({});
                const matchingTab = allTabs.find(tab => tab.url === link.url);
                
                if (matchingTab) {
                    // If found, switch to that tab
                    await browser.tabs.update(matchingTab.id, { active: true });
                    // If the tab is in a different window, focus that window too
                    await browser.windows.update(matchingTab.windowId, { focused: true });
                } else {
                    // If no existing tab, create a new one
                    await browser.tabs.create({ url: link.url });
                }
            });
            // Add remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-link';
            removeBtn.innerHTML = '✕';
            removeBtn.title = 'Remove relationship';
            removeBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await browser.runtime.sendMessage({
                    type: 'removeRelationship',
                    sourceUrl: currentUrl,
                    targetUrl: link.url
                });
            });
            
            li.appendChild(a);
            li.appendChild(removeBtn);
            linksList.appendChild(li);
        }
    });
}

// Search functionality
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const links = document.querySelectorAll('#relatedLinks li');
    
    links.forEach(link => {
        const text = link.textContent.toLowerCase();
        link.style.display = text.includes(searchTerm) ? '' : 'none';
    });
});

// Clear history functionality
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const confirmationBanner = document.getElementById('confirmationBanner');
const confirmClearBtn = document.getElementById('confirmClear');
const cancelClearBtn = document.getElementById('cancelClear');

clearHistoryBtn.addEventListener('click', () => {
    confirmationBanner.classList.remove('hidden');
});

cancelClearBtn.addEventListener('click', () => {
    confirmationBanner.classList.add('hidden');
});

confirmClearBtn.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'clearHistory' });
    confirmationBanner.classList.add('hidden');
    // Refresh the sidebar
    browser.runtime.sendMessage({ type: 'getRelatedTabs' });
});

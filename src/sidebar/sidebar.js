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
            throw new Error(response?.error || 'Failed to get related tabs');
        }
        console.log('Successfully requested related tabs');
    }).catch(error => {
        console.error('Error requesting related tabs:', error);
        linksList.innerHTML = '<li>Error loading tabs</li>';
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
    const links = message.links;
    console.log('Received links update:', message);
    const linksList = document.getElementById('relatedLinks');
    linksList.innerHTML = '';

    if (!Array.isArray(links) || links.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No related tabs found';
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
            
            // Clean up the title by removing any numeric prefixes
            // Try to get a readable title, falling back to hostname if needed
            let displayTitle;
            if (link.title) {
                displayTitle = link.title;
            } else {
                try {
                    const urlObj = new URL(link.url);
                    displayTitle = urlObj.hostname.replace(/^www\./, '');
                    if (urlObj.pathname !== '/') {
                        displayTitle += urlObj.pathname;
                    }
                } catch (e) {
                    displayTitle = link.url;
                }
            }
            const titleSpan = document.createElement('span');
            titleSpan.textContent = displayTitle.replace(/^\d+\s*-\s*/, '').trim();
            titleSpan.title = link.url; // Show full URL on hover
            
            a.appendChild(favicon);
            a.appendChild(titleSpan);
            a.addEventListener('click', (e) => {
                e.preventDefault();
                browser.tabs.update({ url: link.url });
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

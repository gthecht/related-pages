console.log('Sidebar script loaded');

// Request initial related tabs when sidebar loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Sidebar DOM loaded');
    const linksList = document.getElementById('relatedLinks');
    linksList.innerHTML = '<li>Loading...</li>';
    
    // Wait a moment for the background script to be ready
    setTimeout(() => {
        browser.runtime.sendMessage({
            type: 'getRelatedTabs'
        }).catch(error => {
            console.error('Error requesting related tabs:', error);
            linksList.innerHTML = '<li>Error loading tabs</li>';
        });
    }, 100);
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message in sidebar:', message);
    if (message.type === 'updateRelatedLinks') {
        updateRelatedLinks(message.links);
    }
    // Always return true to indicate async response
    return true;
});

// Update the sidebar with related links
function updateRelatedLinks(links) {
    console.log('Received links update:', links);
    const linksList = document.getElementById('relatedLinks');
    linksList.innerHTML = '';

    if (links.length === 0) {
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
            
            // Add favicon
            const favicon = document.createElement('img');
            favicon.className = 'favicon';
            try {
                const urlObj = new URL(link.url);
                favicon.src = `${urlObj.origin}/favicon.ico`;
            } catch (e) {
                favicon.src = 'chrome://favicon/size/16@1x/' + link.url;
            }
            favicon.onerror = () => {
                favicon.src = 'chrome://favicon/size/16@1x/' + link.url;
            };
            
            // Clean up the title by removing any numeric prefixes
            const displayTitle = link.title || link.url;
            const titleSpan = document.createElement('span');
            titleSpan.textContent = displayTitle.replace(/^\d+\s*-\s*/, '').trim();
            
            a.appendChild(favicon);
            a.appendChild(titleSpan);
            a.addEventListener('click', (e) => {
                e.preventDefault();
                browser.tabs.update({ url: link.url });
            });
            li.appendChild(a);
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

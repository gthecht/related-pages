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
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.title || link.url;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            browser.tabs.update({ url: link.url });
        });
        li.appendChild(a);
        linksList.appendChild(li);
    });
}

// Search functionality
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    
    if (searchTerm) {
        const links = document.querySelectorAll('#relatedLinks li');
        links.forEach(link => {
            const text = link.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
                searchResults.appendChild(link.cloneNode(true));
            }
        });
    }
});

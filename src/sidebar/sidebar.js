// Request initial related tabs when sidebar loads
document.addEventListener('DOMContentLoaded', () => {
    browser.runtime.sendMessage({
        type: 'getRelatedTabs'
    });
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'updateRelatedLinks') {
        updateRelatedLinks(message.links);
    }
});

// Update the sidebar with related links
function updateRelatedLinks(links) {
    const linksList = document.getElementById('relatedLinks');
    linksList.innerHTML = '';

    links.forEach(link => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = link.url;
        a.textContent = link.title || link.url;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            browser.tabs.create({ url: link.url });
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

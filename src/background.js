// Store for tracking tab relationships
let tabRelationships = new Map();

// Listen for tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        updateTabRelationships(tabId, tab);
    }
});

// Listen for tab removal
browser.tabs.onRemoved.addListener((tabId) => {
    tabRelationships.delete(tabId);
});

// Update relationships when tabs are created
browser.tabs.onCreated.addListener((tab) => {
    if (tab.openerTabId) {
        addRelationship(tab.openerTabId, tab.id);
    }
});

// Function to update tab relationships
async function updateTabRelationships(tabId, tab) {
    // Get the current active tab as it might be related
    const activeTabs = await browser.tabs.query({active: true, currentWindow: true});
    if (activeTabs.length > 0 && activeTabs[0].id !== tabId) {
        addRelationship(activeTabs[0].id, tabId);
    }
}

// Add a relationship between two tabs
function addRelationship(sourceTabId, targetTabId) {
    if (!tabRelationships.has(sourceTabId)) {
        tabRelationships.set(sourceTabId, new Set());
    }
    tabRelationships.get(sourceTabId).add(targetTabId);
    
    // Update sidebar with related tabs
    updateSidebar(sourceTabId);
}

// Update the sidebar with related tabs
async function updateSidebar(tabId) {
    const relatedTabs = [];
    
    if (tabRelationships.has(tabId)) {
        const relatedIds = Array.from(tabRelationships.get(tabId));
        for (const relatedId of relatedIds) {
            try {
                const tab = await browser.tabs.get(relatedId);
                relatedTabs.push({
                    url: tab.url,
                    title: tab.title
                });
            } catch (e) {
                // Tab might have been closed
                continue;
            }
        }
    }

    // Send updated links to sidebar
    browser.runtime.sendMessage({
        type: 'updateRelatedLinks',
        links: relatedTabs
    });
}

// Listen for messages from the sidebar
browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'getRelatedTabs') {
        browser.tabs.query({active: true, currentWindow: true})
            .then(tabs => {
                if (tabs.length > 0) {
                    updateSidebar(tabs[0].id);
                }
            });
    }
});

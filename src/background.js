console.log("Background script loaded");

// Store for tracking page relationships
let pageRelationships = new Map();
let currentActiveTabId = null;

// Store for tracking navigation history with titles
let pageHistory = new Map();

// Load stored relationships
async function loadStoredData() {
  const data = await browser.storage.local.get('pageRelationships');
  if (data.pageRelationships) {
    // Convert stored object back to Map
    const relationships = new Map();
    Object.entries(data.pageRelationships).forEach(([key, value]) => {
      relationships.set(key, new Set(value));
    });
    pageRelationships = relationships;
    console.log('Loaded stored relationships:', pageRelationships);
  }
}

// Save relationships to storage
async function saveRelationships() {
  // Convert Map to object for storage
  const relationshipsObj = {};
  pageRelationships.forEach((value, key) => {
    relationshipsObj[key] = Array.from(value);
  });
  
  await browser.storage.local.set({
    pageRelationships: relationshipsObj
  });
  console.log('Saved relationships to storage');
}

// Initialize when the extension loads
async function initializePageHistory() {
  await loadStoredData();
  const tabs = await browser.tabs.query({});
  console.log("Initializing with existing pages:", tabs.length);
  
  tabs.forEach(tab => {
    pageHistory.set(tab.id, { url: tab.url, previousUrl: null });
  });
}

// Initialize when the extension loads
initializePageHistory();

// Listen for tab activation
browser.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);
  currentActiveTabId = activeInfo.tabId;
  await updateSidebar(activeInfo.tabId);
});

// Listen for tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const pageInfo = pageHistory.get(tabId) || { url: null, previousUrl: null };
    if (pageInfo.url && isValidUrl(pageInfo.url)) {
      // Only create relationship if previous page was valid
      addRelationship(changeInfo.url, pageInfo.url);
    }
    // Store valid URLs with their titles
    if (isValidUrl(changeInfo.url)) {
      pageHistory.set(tabId, {
        url: changeInfo.url,
        previousUrl: pageInfo.url,
        title: tab.title || changeInfo.url
      });
      // Also store URL -> title mapping
      pageHistory.set(changeInfo.url, {
        title: tab.title || changeInfo.url
      });
    }
  }
});

// Update relationships when new pages are opened
browser.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId) {
    const openerInfo = pageHistory.get(tab.openerTabId);
    if (openerInfo) {
      pageHistory.set(tab.id, {
        url: tab.url,
        previousUrl: openerInfo.url
      });
      addRelationship(tab.url, openerInfo.url);
    }
  }
});

// Check if URL is valid for relationship tracking
function isValidUrl(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return !['about:', 'chrome:', 'moz-extension:'].includes(urlObj.protocol.toLowerCase());
  } catch (e) {
    return false;
  }
}

// Add a relationship between two URLs
function addRelationship(sourceUrl, targetUrl) {
  // Skip invalid or internal URLs
  if (!isValidUrl(sourceUrl) || !isValidUrl(targetUrl)) {
    console.log('Skipping invalid URLs:', { sourceUrl, targetUrl });
    return;
  }

  // Add source -> target relationship
  if (!pageRelationships.has(sourceUrl)) {
    pageRelationships.set(sourceUrl, new Set());
  }
  pageRelationships.get(sourceUrl).add(targetUrl);

  // Add target -> source relationship
  if (!pageRelationships.has(targetUrl)) {
    pageRelationships.set(targetUrl, new Set());
  }
  pageRelationships.get(targetUrl).add(sourceUrl);

  console.log(
    `Added relationship between URLs ${sourceUrl} <-> ${targetUrl}`,
  );
  
  // Save updated relationships
  saveRelationships();

  // Update sidebar for current tab
  if (currentActiveTabId) {
    updateSidebar(currentActiveTabId);
  }
}

// Update the sidebar with related tabs
async function updateSidebar(tabId) {
  const relatedTabs = [];
  console.log("Updating sidebar for tab:", tabId);
  
  try {
    const currentTab = await browser.tabs.get(tabId);
    const currentUrl = currentTab.url;
    console.log("Current URL:", currentUrl);
    console.log("Current relationships:", pageRelationships);

    if (pageRelationships.has(currentUrl)) {
      const relatedUrls = Array.from(pageRelationships.get(currentUrl));
      console.log("Related URLs found:", relatedUrls);
      
      // Find tabs with related URLs
      const allTabs = await browser.tabs.query({});
      for (const relatedUrl of relatedUrls) {
        const matchingTab = allTabs.find(tab => tab.url === relatedUrl);
        if (matchingTab) {
          relatedTabs.push({
            url: matchingTab.url,
            title: matchingTab.title,
          });
        } else {
          // For URLs not currently open in a tab, try to use stored title or generate one
          const storedPage = pageHistory.get(relatedUrl);
          if (storedPage && storedPage.title) {
            relatedTabs.push({
              url: relatedUrl,
              title: storedPage.title
            });
          } else {
            // Fallback to generating a title from the URL
            try {
              const urlObj = new URL(relatedUrl);
              const title = urlObj.pathname !== "/" ? 
                decodeURIComponent(urlObj.pathname.substring(1)).replace(/-|_/g, ' ') : 
                urlObj.hostname;
              relatedTabs.push({
                url: relatedUrl,
                title: title
              });
            } catch (e) {
              relatedTabs.push({
                url: relatedUrl,
                title: relatedUrl
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.log("Error updating sidebar:", e);
  }

  console.log("Sending related tabs to sidebar:", relatedTabs);
  // Send message to all extension contexts
  browser.runtime
    .sendMessage({
      type: "updateRelatedLinks",
      links: relatedTabs,
    })
    .catch((error) => {
      // This error is expected if no sidebar is open to receive the message
      console.log("Could not send to sidebar (may not be open):", error);
    });
}

// Listen for messages from the sidebar
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "getRelatedTabs") {
    return new Promise((resolve) => {
      browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          if (tabs.length > 0) {
            currentActiveTabId = tabs[0].id;
            updateSidebar(currentActiveTabId);
            resolve({ success: true });
          } else {
            resolve({ success: false, error: "No active tab found" });
          }
        })
        .catch((error) => {
          console.error("Error getting active tab:", error);
          resolve({ success: false, error: error.message });
        });
    });
  }
  return true;
});

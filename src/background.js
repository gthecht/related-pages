console.log("Background script loaded");

// Store for tracking page relationships with weights
let pageRelationships = new Map();
let currentActiveTabId = null;

// Store for tracking navigation history with titles and timestamps
let pageHistory = new Map();

// Store for manually removed relationships
let removedRelationships = new Set();

// Constants for weight calculation and cleanup
const WEIGHT_DECAY_FACTOR = 0.9; // How much older relationships decay
const MIN_TRANSITION_TIME = 5000; // Minimum time (ms) to consider a valid transition
const MIN_WEIGHT_THRESHOLD = 0.1; // Minimum weight to keep relationship
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Run cleanup daily

let lastCleanupTime = 0;

// Load stored relationships and cleanup time
async function loadStoredData() {
  const data = await browser.storage.local.get([
    "pageRelationships",
    "lastCleanupTime",
    "removedRelationships",
  ]);
  if (data.lastCleanupTime) {
    lastCleanupTime = data.lastCleanupTime;
  }
  if (data.removedRelationships) {
    removedRelationships = new Set(data.removedRelationships);
  }
  if (data.pageRelationships) {
    // Convert stored object back to Map with weights
    const relationships = new Map();
    Object.entries(data.pageRelationships).forEach(([key, value]) => {
      const weightedSet = new Map();
      Object.entries(value).forEach(([url, data]) => {
        weightedSet.set(url, {
          weight: data.weight,
          lastAccessed: data.lastAccessed,
          count: data.count,
        });
      });
      relationships.set(key, weightedSet);
    });
    pageRelationships = relationships;
    console.log("Loaded stored relationships:", pageRelationships);
  }
}

// Clean up old and weak relationships
function cleanupRelationships() {
  const now = Date.now();

  // Only run cleanup once per CLEANUP_INTERVAL
  if (now - lastCleanupTime < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanupTime = now;
  console.log("Running relationship cleanup...");
  let removedCount = 0;
  for (const [url, relations] of pageRelationships.entries()) {
    for (const [relatedUrl, data] of relations.entries()) {
      // Remove if weight is too low
      if (data.weight < MIN_WEIGHT_THRESHOLD) {
        relations.delete(relatedUrl);
        removedCount++;
        console.log(
          `Removed relationship: ${url} -> ${relatedUrl} (weight: ${data.weight})`,
        );
      }
    }
    // Remove empty relation sets
    if (relations.size === 0) {
      pageRelationships.delete(url);
      console.log(`Removed empty relationship set for: ${url}`);
    }
  }

  if (removedCount > 0) {
    console.log(`Cleanup complete. Removed ${removedCount} relationships`);
  }
}

// Save relationships to storage
async function saveRelationships() {
  cleanupRelationships();
  // Convert Map to object for storage
  const relationshipsObj = {};
  pageRelationships.forEach((value, key) => {
    const weightedObj = {};
    value.forEach((data, url) => {
      weightedObj[url] = {
        weight: data.weight,
        lastAccessed: data.lastAccessed,
        count: data.count,
      };
    });
    relationshipsObj[key] = weightedObj;
  });

  await browser.storage.local.set({
    pageRelationships: relationshipsObj,
    lastCleanupTime: lastCleanupTime,
    removedRelationships: Array.from(removedRelationships),
  });
  console.log("Saved relationships and cleanup time to storage");
}

// Initialize when the extension loads
async function initializePageHistory() {
  await loadStoredData();
  const tabs = await browser.tabs.query({});
  console.log("Initializing with existing pages:", tabs.length);

  tabs.forEach((tab) => {
    pageHistory.set(tab.id, { url: tab.url, previousUrl: null });
  });
}

// Initialize when the extension loads
initializePageHistory();

// Listen for tab activation
browser.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);

  // Get previous and current tab info
  const currentTab = await browser.tabs.get(activeInfo.tabId);
  const previousTabId = currentActiveTabId;

  if (previousTabId) {
    try {
      const previousTab = await browser.tabs.get(previousTabId);
      // Add relationship between previous and current tab
      if (
        previousTab &&
        currentTab &&
        isValidUrl(previousTab.url) &&
        isValidUrl(currentTab.url)
      ) {
        addRelationship(currentTab.url, previousTab.url);
      }
    } catch (e) {
      console.log("Previous tab may have been closed");
    }
  }

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
        title: tab.title || changeInfo.url,
      });
      // Also store URL -> title mapping
      pageHistory.set(changeInfo.url, {
        title: tab.title || null,
      });
    }
  }
});

// Update relationships when new pages are opened
browser.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId) {
    const openerInfo = pageHistory.get(tab.openerTabId);
    if (openerInfo && openerInfo.url) {
      const openerTab = await browser.tabs.get(tab.openerTabId);
      pageHistory.set(tab.id, {
        url: tab.url,
        previousUrl: openerInfo.url,
        title: tab.title || tab.url,
      });
      if (isValidUrl(tab.url) && isValidUrl(openerInfo.url)) {
        addRelationship(tab.url, openerInfo.url);
      }
    }
  }
});

// Normalize URL by removing www and trailing slashes
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove www
    let hostname = urlObj.hostname.replace(/^www\./, "");
    // Remove trailing slash
    let pathname = urlObj.pathname.replace(/\/$/, "") || "/";
    // Reconstruct URL
    return `${urlObj.protocol}//${hostname}${pathname}${urlObj.search}${urlObj.hash}`;
  } catch (e) {
    return url;
  }
}

// Check if URL is valid for relationship tracking
function isValidUrl(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return !["about:", "chrome:", "moz-extension:"].includes(
      urlObj.protocol.toLowerCase(),
    );
  } catch (e) {
    return false;
  }
}

// Update the weight of a relationship between two URLs
function updateRelationshipWeight(fromUrl, toUrl, timestamp) {
  if (!pageRelationships.has(fromUrl)) {
    pageRelationships.set(fromUrl, new Map());
  }
  const relations = pageRelationships.get(fromUrl);
  const existing = relations.get(toUrl);
  relations.set(toUrl, {
    weight: (existing?.weight || 0) * WEIGHT_DECAY_FACTOR + 1,
    lastAccessed: timestamp,
    count: (existing?.count || 0) + 1,
  });
}

// Add a relationship between two URLs
function addRelationship(sourceUrl, targetUrl) {
  // Skip invalid or internal URLs
  if (!isValidUrl(sourceUrl) || !isValidUrl(targetUrl)) {
    console.log("Skipping invalid URLs:", { sourceUrl, targetUrl });
    return;
  }

  const now = Date.now();
  const sourceInfo = pageHistory.get(sourceUrl) || {};

  // Skip if transition was too quick (likely accidental)
  if (
    sourceInfo.lastAccessed &&
    now - sourceInfo.lastAccessed < MIN_TRANSITION_TIME
  ) {
    return;
  }

  // Skip if relationship was manually removed
  const relationshipKey = JSON.stringify([sourceUrl, targetUrl].sort());
  if (removedRelationships.has(relationshipKey)) {
    return;
  }

  updateRelationshipWeight(sourceUrl, targetUrl, now);
  updateRelationshipWeight(targetUrl, sourceUrl, now);

  console.log(`Added relationship between URLs ${sourceUrl} <-> ${targetUrl}`);

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
      const relatedUrls = Array.from(
        pageRelationships.get(currentUrl).entries(),
      )
        .filter(([url]) => url !== currentUrl) // Filter out self-references
        .sort((a, b) => b[1].weight - a[1].weight)
        .map(([url]) => url);
      console.log("Related URLs found:", relatedUrls);

      // Find tabs with related URLs
      const allTabs = await browser.tabs.query({});
      for (const relatedUrl of relatedUrls) {
        const matchingTab = allTabs.find((tab) => tab.url === relatedUrl);
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
              title: storedPage.title,
            });
          } else {
            // Fallback to generating a title from the URL
            try {
              const urlObj = new URL(relatedUrl);
              const title =
                urlObj.pathname !== "/"
                  ? decodeURIComponent(urlObj.pathname.substring(1)).replace(
                      /-|_/g,
                      " ",
                    )
                  : urlObj.hostname;
              relatedTabs.push({
                url: relatedUrl,
                title: title,
              });
            } catch (e) {
              relatedTabs.push({
                url: relatedUrl,
                title: relatedUrl,
              });
            }
          }
        }
      }
    }

    console.log("Sending related tabs to sidebar:", relatedTabs);
    // Send message to all extension contexts
    browser.runtime
      .sendMessage({
        type: "updateRelatedLinks",
        links: relatedTabs,
        url: currentUrl,
      })
      .catch((error) => {
        // This error is expected if no sidebar is open to receive the message
        console.log("Could not send to sidebar (may not be open):", error);
      });
  } catch (e) {
    console.log("Error updating sidebar:", e);
  }
}

// Listen for messages from the sidebar
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "getRelatedTabs") {
    return new Promise(async (resolve) => {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs.length > 0) {
          currentActiveTabId = tabs[0].id;
          updateSidebar(currentActiveTabId);
          resolve({ success: true });
        } else {
          resolve({ success: false, error: "No active tab found" });
        }
      } catch (error) {
        console.error("Error getting active tab:", error);
        resolve({ success: false, error: error.message });
      }
    });
  }
  if (message.type === "clearHistory") {
    return new Promise((resolve) => {
      pageRelationships.clear();
      pageHistory.clear();
      saveRelationships();
      resolve({ success: true });
    });
  }
  if (message.type === "removeRelationship") {
    return new Promise((resolve) => {
      const { sourceUrl, targetUrl } = message;
      // Add both directions to removed set
      removedRelationships.add(JSON.stringify([sourceUrl, targetUrl].sort()));

      // Remove from current relationships
      if (pageRelationships.has(sourceUrl)) {
        pageRelationships.get(sourceUrl).delete(targetUrl);
      }
      if (pageRelationships.has(targetUrl)) {
        pageRelationships.get(targetUrl).delete(sourceUrl);
      }

      saveRelationships();
      updateSidebar(currentActiveTabId);
      resolve({ success: true });
    });
  }
  return true;
});

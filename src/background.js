console.log("Background script loaded");

// Centralized store for page information including titles, relationships and metadata
let pageInfo = new Map(); // Maps URL -> { title, lastAccessed, favicon, relationships: Map<URL, {weight, count}> }
let currentActiveTabId = null;

// Store for tracking navigation history
let pageHistory = new Map();

// Import configuration from central config file
import { CONFIG } from "./config/config.js";

let lastCleanupTime = 0;

// Load stored relationships and cleanup time
async function loadStoredData() {
  const data = await browser.storage.local.get([
    "pageInfo",
    "lastCleanupTime",
    "removedRelationships",
  ]);
  if (data.lastCleanupTime) {
    lastCleanupTime = data.lastCleanupTime;
  }

  if (data.pageInfo) {
    // Convert stored object back to Map with all page information
    const info = new Map();
    Object.entries(data.pageInfo).forEach(([url, data]) => {
      const relationships = new Map();
      if (data.relationships) {
        Object.entries(data.relationships).forEach(([relatedUrl, relData]) => {
          relationships.set(relatedUrl, {
            weight: relData.weight,
            count: relData.count,
          });
        });
      }
      info.set(url, {
        title: data.title || url,
        lastAccessed: data.lastAccessed || Date.now(),
        favicon: data.favicon,
        relationships: relationships,
      });
    });
    pageInfo = info;
    console.log("Loaded stored page info:", pageInfo);
  }
}

// Clean up old and weak relationships
function cleanupRelationships() {
  const now = Date.now();

  // Only run cleanup once per CLEANUP_INTERVAL
  if (now - lastCleanupTime < CONFIG.timing.cleanupInterval) {
    return;
  }

  // Clean up old and weak relationships
  lastCleanupTime = now;
  console.log("Running relationship cleanup...");
  let removedCount = 0;
  for (const [url, info] of pageInfo.entries()) {
    const relations = info.relationships;
    for (const [relatedUrl, data] of relations.entries()) {
      // Remove if weight is too low
      if (data.weight < CONFIG.weights.minimum) {
        relations.delete(relatedUrl);
        removedCount++;
        console.log(
          `Removed relationship: ${url} -> ${relatedUrl} (weight: ${data.weight})`,
        );
      }
    }
    // Remove pages with no relationships
    if (relations.size === 0) {
      pageInfo.delete(url);
      console.log(`Removed page with no relationships: ${url}`);
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
  const pageInfoObj = {};
  pageInfo.forEach((info, url) => {
    const relationshipsObj = {};
    info.relationships.forEach((data, relatedUrl) => {
      relationshipsObj[relatedUrl] = {
        weight: data.weight,
        count: data.count,
      };
    });
    pageInfoObj[url] = {
      title: info.title,
      lastAccessed: info.lastAccessed,
      favicon: info.favicon,
      relationships: relationshipsObj,
    };
  });

  await browser.storage.local.set({
    pageInfo: pageInfoObj,
    lastCleanupTime: lastCleanupTime,
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

// Check if a string looks like a URL
function looksLikeUrl(str) {
  return (
    str &&
    (str.includes("://") ||
      str.includes("/") ||
      str.startsWith("www.") ||
      /\.[a-z]{2,}$/i.test(str))
  );
}

// Listen for tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If page is completely loaded and there's relationships, update sidebar
  if (changeInfo.status === 'complete' && tab.url && pageInfo.has(tab.url)) {
    updateSidebar(tabId);
  }
  // Handle URL changes
  if (changeInfo.url) {
    const pageInfo = pageHistory.get(tabId) || { url: null, previousUrl: null };
    if (pageInfo.url && isValidUrl(pageInfo.url)) {
      // Only create relationship if previous page was valid
      addRelationship(changeInfo.url, pageInfo.url);
    }
    // Store valid URLs with their info
    if (isValidUrl(changeInfo.url)) {
      pageHistory.set(tabId, {
        url: changeInfo.url,
        previousUrl: pageInfo.url,
      });

      // Update centralized page info
      const existingInfo = pageInfo.get(changeInfo.url) || {
        relationships: new Map(),
      };
      // Don't overwrite title if it's not a URL-like string
      const currentTitle = existingInfo.title;
      const shouldKeepTitle =
        currentTitle &&
        !looksLikeUrl(currentTitle) &&
        currentTitle !== "undefined";

      pageInfo.set(changeInfo.url, {
        ...existingInfo,
        title: shouldKeepTitle ? currentTitle : tab.title || changeInfo.url,
        lastAccessed: Date.now(),
        favicon: tab.favIconUrl,
      });
    }
  }
  // Handle title changes
  else if (changeInfo.title && tab.url) {
    const url = tab.url;
    if (isValidUrl(url)) {
      const existingInfo = pageInfo.get(url) || { relationships: new Map() };
      // Only update title if current one looks like a URL or is missing
      const currentTitle = existingInfo.title;
      const shouldUpdateTitle =
        !currentTitle ||
        looksLikeUrl(currentTitle) ||
        currentTitle === "undefined" ||
        currentTitle === url;

      if (shouldUpdateTitle) {
        pageInfo.set(url, {
          ...existingInfo,
          title: changeInfo.title,
          lastAccessed: Date.now(),
        });
        // Save the updated title
        saveRelationships();
      }
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
        updateSidebar(tab.id);
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
  if (!pageInfo.has(fromUrl)) {
    pageInfo.set(fromUrl, {
      title: fromUrl,
      lastAccessed: timestamp,
      relationships: new Map(),
    });
  }
  const info = pageInfo.get(fromUrl);
  const existing = info.relationships.get(toUrl);
  info.relationships.set(toUrl, {
    weight:
      (existing?.weight || 0) * CONFIG.weights.decayFactor +
      CONFIG.weights.initial,
    count: (existing?.count || 0) + 1,
  });
  info.lastAccessed = timestamp;
}

// Add a relationship between two URLs
function addRelationship(sourceUrl, targetUrl) {
  // Skip invalid, internal, or identical URLs
  if (
    !isValidUrl(sourceUrl) ||
    !isValidUrl(targetUrl) ||
    sourceUrl === targetUrl
  ) {
    console.log("Skipping invalid or self-referential URLs:", {
      sourceUrl,
      targetUrl,
    });
    return;
  }

  const now = Date.now();
  const sourceInfo = pageHistory.get(sourceUrl) || {};

  // Skip if transition was too quick (likely accidental)
  if (
    sourceInfo.lastAccessed &&
    now - sourceInfo.lastAccessed < CONFIG.timing.minTransition
  ) {
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
    console.log("Current page info:", pageInfo);

    if (pageInfo.has(currentUrl)) {
      const currentPageInfo = pageInfo.get(currentUrl);
      const relatedUrls = Array.from(currentPageInfo.relationships.entries())
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
          // For URLs not currently open in a tab, use stored info or generate title
          const storedInfo = pageInfo.get(relatedUrl);
          if (storedInfo && storedInfo.title) {
            relatedTabs.push({
              url: relatedUrl,
              title: storedInfo.title,
              favicon: storedInfo.favicon,
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
      pageInfo.clear();
      pageHistory.clear();

      saveRelationships();
      resolve({ success: true });
    });
  }
  if (message.type === "removeRelationship") {
    return new Promise((resolve) => {
      const { sourceUrl, targetUrl } = message;
      // Delete relationship in both directions
      if (pageInfo.has(sourceUrl)) {
        const info = pageInfo.get(sourceUrl);
        info.relationships.delete(targetUrl);
        // Remove page if it has no more relationships
        if (info.relationships.size === 0) {
          pageInfo.delete(sourceUrl);
        }
      }
      if (pageInfo.has(targetUrl)) {
        const info = pageInfo.get(targetUrl);
        info.relationships.delete(sourceUrl);
        // Remove page if it has no more relationships
        if (info.relationships.size === 0) {
          pageInfo.delete(targetUrl);
        }
      }

      saveRelationships();
      updateSidebar(currentActiveTabId);
      resolve({ success: true });
    });
  }
  return true;
});

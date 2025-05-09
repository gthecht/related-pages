console.log("Background script loaded");

// Store for tracking tab relationships
let tabRelationships = new Map();
let currentActiveTabId = null;

// Initialize relationships from existing tabs
async function initializeTabRelationships() {
  const tabs = await browser.tabs.query({});
  console.log("Initializing with existing tabs:", tabs.length);

  // Group tabs by window
  const tabsByWindow = new Map();
  tabs.forEach((tab) => {
    if (!tabsByWindow.has(tab.windowId)) {
      tabsByWindow.set(tab.windowId, []);
    }
    tabsByWindow.get(tab.windowId).push(tab);
  });

  // Create relationships between sequential tabs in each window
  tabsByWindow.forEach((windowTabs) => {
    for (let i = 0; i < windowTabs.length - 1; i++) {
      addRelationship(windowTabs[i].id, windowTabs[i + 1].id);
    }
  });

  // Update sidebar with initial state
  const activeTabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTabs.length > 0) {
    currentActiveTabId = activeTabs[0].id;
    await updateSidebar(currentActiveTabId);
  }
}

// Initialize when the extension loads
initializeTabRelationships();

// Listen for tab activation
browser.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);
  currentActiveTabId = activeInfo.tabId;
  await updateSidebar(activeInfo.tabId);
});

// Listen for tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    updateTabRelationships(tabId, tab);
  }
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
  const activeTabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTabs.length > 0 && activeTabs[0].id !== tabId) {
    addRelationship(activeTabs[0].id, tabId);
  }
}

// Add a relationship between two tabs
function addRelationship(sourceTabId, targetTabId) {
  // Add source -> target relationship
  if (!tabRelationships.has(sourceTabId)) {
    tabRelationships.set(sourceTabId, new Set());
  }
  tabRelationships.get(sourceTabId).add(targetTabId);

  // Add target -> source relationship
  if (!tabRelationships.has(targetTabId)) {
    tabRelationships.set(targetTabId, new Set());
  }
  tabRelationships.get(targetTabId).add(sourceTabId);

  console.log(
    `Added relationship between tabs ${sourceTabId} <-> ${targetTabId}`,
  );

  // Update sidebar for both tabs if either is active
  if (
    currentActiveTabId === sourceTabId ||
    currentActiveTabId === targetTabId
  ) {
    updateSidebar(currentActiveTabId);
  }
}

// Update the sidebar with related tabs
async function updateSidebar(tabId) {
  const relatedTabs = [];
  console.log("Updating sidebar for tab:", tabId);
  console.log("Current relationships:", tabRelationships);

  if (tabRelationships.has(tabId)) {
    const relatedIds = Array.from(tabRelationships.get(tabId));
    console.log("Related IDs found:", relatedIds);
    for (const relatedId of relatedIds) {
      try {
        const tab = await browser.tabs.get(relatedId);
        relatedTabs.push({
          url: tab.url,
          title: tab.title,
        });
      } catch (e) {
        console.log("Error getting tab:", relatedId, e);
        continue;
      }
    }
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

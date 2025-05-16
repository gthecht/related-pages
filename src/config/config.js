export const CONFIG = {
    // Weight settings
    weights: {
        decayFactor: 0.9,    // How much older relationships decay
        minimum: 0.1,        // Minimum weight to keep relationship
        initial: 1.0         // Initial weight for new relationships
    },
    
    // Timing settings
    timing: {
        minTransition: 5000, // Minimum time (ms) to consider a valid transition
        cleanupInterval: 24 * 60 * 60 * 1000  // Run cleanup daily (24h)
    },

    // Display settings
    display: {
        maxDefaultPages: 5  // Maximum number of related pages to show in default view
    }
};
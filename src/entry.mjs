import { createApp } from './server.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';

// Create the Express app
const config = loadConfig();
const store = new Store(config.dataDir);

const expressApp = createApp({ config, store });

// Export for Astro SSR adapter
export default expressApp;
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { poll } from './poller.js';

const config = loadConfig();
const store = new Store(config.dataDir);

try {
  const result = await poll(store, config);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} catch (err) {
  console.error('Poll failed:', err.message);
  process.exit(1);
}

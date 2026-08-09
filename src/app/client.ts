/** Module-scope singleton so React StrictMode's double-mount cannot spawn two
 * simulation workers (which would double CPU use and desynchronise the view). */
import { SimClient } from './simClient';

let client: SimClient | null = null;

export function getClient(): SimClient {
  if (!client) client = new SimClient();
  return client;
}

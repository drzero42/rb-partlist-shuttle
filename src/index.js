/**
 * Entry point: page guard → config → button wiring (spec §8, §16.2).
 *
 * Does nothing at all unless the current page is a Custom List
 * (`/users/<u>/lists/<id>/`). The two flows it wires are consume (§6.1) and
 * return (§6.2); both are dry-run-first (§7.1) and both refuse to write unless
 * the plan is feasible (D11) and backups succeeded (§7.3).
 */

import styles from './styles.css';
import { addStyle, loadConfig } from './gm.js';
import { injectShuttleButtons, matchCustomListPage } from './ui.js';

/**
 * Consume: Custom List → staging (§6.1).
 *
 * @param {{username: string, listId: string, config: import('./gm.js').ShuttleConfig}} ctx
 * @returns {Promise<void>}
 */
export async function runConsume(ctx) {
  throw new Error(`NotImplemented: index.runConsume(list ${ctx.listId})`);
}

/**
 * Return: staging → home boxes (§6.2).
 *
 * @param {{username: string, listId: string, config: import('./gm.js').ShuttleConfig}} ctx
 * @returns {Promise<void>}
 */
export async function runReturn(ctx) {
  throw new Error(`NotImplemented: index.runReturn(list ${ctx.listId})`);
}

/**
 * Guard, style, configure, inject. Called once at `document-idle`.
 *
 * @param {{pathname?: string} } [env] injectable for tests
 * @returns {boolean} true when the UI was injected
 */
export function main(env) {
  const pathname = env?.pathname ?? globalThis.location?.pathname;
  const page = matchCustomListPage(pathname);
  if (!page) return false;

  const config = loadConfig();
  addStyle(styles);
  injectShuttleButtons({
    stagingName: config.stagingName,
    onConsume: () => runConsume({ ...page, config }),
    onReturn: () => runReturn({ ...page, config }),
  });
  return true;
}

if (typeof globalThis.document !== 'undefined') main();

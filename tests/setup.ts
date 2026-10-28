/**
 * Vitest setup.
 *
 * `jsdom` is the environment because the substrate persists to localStorage, but the overwhelming
 * majority of this suite is pure graph logic that never touches the DOM. What every test does need
 * is isolation from the persisted log: the store boots from localStorage, so a test that leaves a
 * graph behind hands the next test a log it did not build, and the failure surfaces three files away
 * as a hash mismatch nobody can explain.
 */
import { beforeEach } from "vitest";

const STORAGE_KEYS = [
  "whylog:events:v1",
  "whylog:head:v1",
  "whylog:config:v1",
  "whylog:baseline:v1",
  "whylog:tuning:v1",
  "whylog:integrity",
  "whylog:demo:v1",
];

beforeEach(() => {
  for (const key of STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* jsdom always provides localStorage; a real failure here is worth seeing, but a storage-less
       * environment should not take the whole suite down with it. */
    }
  }
});

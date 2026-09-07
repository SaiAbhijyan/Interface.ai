import type { Page } from "playwright";
import type { PlaywrightSurfaceDriver } from "../../src/surface/playwright-driver.js";

/**
 * Test-only access to the underlying Playwright Page.
 * Intentionally NOT exported from the production SurfaceDriver / driver module —
 * integration PoCs import this helper; production automation must use gated APIs.
 */
export function rawPageForTests(driver: PlaywrightSurfaceDriver): Page {
  const page = (driver as unknown as { page: Page | null }).page;
  if (!page) throw new Error("Driver not open — call open() first");
  return page;
}

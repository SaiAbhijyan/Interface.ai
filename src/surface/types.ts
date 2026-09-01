/**
 * Shared SurfaceDriver interface.
 *
 * Web (Playwright) is the concrete implementation in this take-home.
 * A desktop driver (e.g. OS accessibility / UI Automation) would implement
 * the same contract so discovery, replay, and HITL stay surface-agnostic.
 */

export type ObserveSnapshot = {
  url: string;
  title: string;
  /** Compact accessibility-oriented tree for the LLM / debugging */
  accessibilityTree: string;
  /** Visible text excerpt (redacted upstream) */
  visibleText: string;
  /** Frame titles present on the page */
  frames: string[];
};

export type DriverLocator = {
  strategy:
    | "role_name"
    | "label"
    | "placeholder"
    | "text"
    | "css"
    | "frame_role_name";
  value: string;
  role?: string;
  frame?: string;
};

export type ClickOptions = { timeoutMs?: number };
export type FillOptions = { timeoutMs?: number; clear?: boolean };

export interface SurfaceDriver {
  readonly kind: "web" | "desktop";

  open(entryUrl: string): Promise<void>;
  close(): Promise<void>;

  observe(): Promise<ObserveSnapshot>;

  click(locator: DriverLocator, options?: ClickOptions): Promise<void>;
  fill(
    locator: DriverLocator,
    value: string,
    options?: FillOptions,
  ): Promise<void>;
  select(locator: DriverLocator, value: string): Promise<void>;
  press(key: string): Promise<void>;
  navigate(url: string): Promise<void>;

  /** Wait until locator is visible; throws on timeout */
  waitFor(locator: DriverLocator, timeoutMs?: number): Promise<void>;

  /** Read text content for a locator */
  readText(locator: DriverLocator): Promise<string>;

  /** True if locator is currently visible */
  isVisible(locator: DriverLocator, timeoutMs?: number): Promise<boolean>;

  screenshot(path: string): Promise<void>;

  /**
   * Yield the live session for human control (HITL).
   * Web: expose CDP/ws endpoint or headed browser.
   * Desktop: release input focus / attach operator tool.
   */
  pauseForHuman(): Promise<HumanSessionHandle>;
}

export type HumanSessionHandle = {
  /** How the operator attaches to the SAME session */
  attachInstructions: string;
  /** Opaque session id for evidence correlation */
  sessionId: string;
  /** Resume automation after human signals done */
  resume: () => Promise<void>;
};

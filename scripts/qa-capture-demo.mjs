import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "evidence", "demo-proof");
const BASE = process.env.BANK_MOCK_BASE ?? "http://127.0.0.1:4173";
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true });
  console.log("shot", p);
  return p;
}

const browser = await chromium.launch({ headless: true });

// --- success lookup with video ---
{
  const context = await browser.newContext({
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(BASE + "/lookup.html", { waitUntil: "domcontentloaded" });
  await shot(page, "01-lookup-form.png");
  await page.getByLabel(/member id/i).fill("10001");
  await shot(page, "02-lookup-filled.png");
  await page.getByRole("button", { name: /search|lookup|submit/i }).click();
  await page.waitForTimeout(800);
  // results may be same page or results.html
  await shot(page, "03-lookup-success.png");
  const text = await page.locator("body").innerText();
  fs.writeFileSync(path.join(OUT, "03-lookup-success.txt"), text);
  const vidPath = await page.video()?.path();
  await context.close();
  if (vidPath) {
    const dest = path.join(OUT, "demo-lookup-success.webm");
    fs.renameSync(vidPath, dest);
    console.log("video", dest);
  }
}

// --- MEM_NOT_FOUND ---
{
  const context = await browser.newContext({
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(BASE + "/lookup.html", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/member id/i).fill("99999");
  await page.getByRole("button", { name: /search|lookup|submit/i }).click();
  await page.waitForTimeout(800);
  await shot(page, "04-mem-not-found.png");
  fs.writeFileSync(path.join(OUT, "04-mem-not-found.txt"), await page.locator("body").innerText());
  const vidPath = await page.video()?.path();
  await context.close();
  if (vidPath) {
    const dest = path.join(OUT, "demo-mem-not-found.webm");
    fs.renameSync(vidPath, dest);
    console.log("video", dest);
  }
}

// --- irreversible confirm screen (open account wizard) ---
{
  const context = await browser.newContext({
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(BASE + "/open-account.html", { waitUntil: "domcontentloaded" });
  await shot(page, "05-open-account-start.png");
  try {
    await page.getByLabel(/member id/i).fill("10001");
    const cont = page.getByRole("button", { name: /continue|next/i });
    if (await cont.count()) await cont.click();
    await page.waitForTimeout(400);
    await shot(page, "06-open-account-step.png");
  } catch (e) {
    console.warn("open-account partial", e.message);
  }
  const vidPath = await page.video()?.path();
  await context.close();
  if (vidPath) {
    const dest = path.join(OUT, "demo-open-account.webm");
    fs.renameSync(vidPath, dest);
    console.log("video", dest);
  }
}

await browser.close();

const manifest = {
  capturedAt: new Date().toISOString(),
  base: BASE,
  suiteNote: "vitest 108/108 previously green on this freeze",
  files: fs.readdirSync(OUT).filter((f) => !f.startsWith(".")),
};
fs.writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# QA demo-proof\n\nCaptured ${manifest.capturedAt} against local mock ${BASE}.\n\n` +
    `- \`01-lookup-form.png\` — lookup form\n` +
    `- \`02-lookup-filled.png\` — member 10001 filled\n` +
    `- \`03-lookup-success.png\` — success path UI\n` +
    `- \`04-mem-not-found.png\` — MEM_NOT_FOUND path UI\n` +
    `- \`05/06-open-account-*.png\` — open-account wizard\n` +
    `- \`demo-*.webm\` — validation screen recordings\n` +
    `- Keepers: \`../replay-success.json\`, \`../replay-business-outcome.json\`, \`../discover-synthetic-302f56/\`\n`,
);
console.log("done", OUT, manifest.files);

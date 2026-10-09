import { chromium } from "file:///C:/Users/amari/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
});

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.screenshot({ path: "implementation-hane.png", fullPage: false });

await page.getByRole("button", { name: /Planejamento do lançamento/ }).click();
await page.getByText("Planejamento do lançamento", { exact: true }).first().waitFor();
await page.getByRole("button", { name: /Equipe de Desenvolvimento/ }).click();

await page.getByRole("button", { name: "Grupo", exact: true }).click();
await page.getByText("Membros do grupo", { exact: true }).waitFor();
await page.getByRole("button", { name: "Grupo", exact: true }).click();

await page.getByPlaceholder("Envie uma mensagem para a equipe...").fill("Consolide o plano e destaque os riscos.");
await page.getByRole("button", { name: "Enviar", exact: true }).click();
await page.getByText("Consolide o plano e destaque os riscos.", { exact: true }).waitFor();

await page.getByRole("button", { name: "Revisar e aprovar", exact: true }).click();
await page.getByRole("button", { name: /Aprovado/, exact: true }).waitFor();

console.log(JSON.stringify({
  title: await page.title(),
  viewport: page.viewportSize(),
  consoleErrors,
  interactions: ["conversation switch", "group settings", "message send", "approval"],
}, null, 2));

await browser.close();

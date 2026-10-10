import { chromium } from "file:///C:/Users/amari/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const BASE = "http://localhost:5180/";
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

async function openSettings(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Abrir configurações do Hane" }).click();
  await page.getByRole("main", { name: "Configurações do Hane" }).waitFor();
}

// 1. live server state (githubAvailable: true, github: null)
const live = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await openSettings(live);
const githubRow = live.locator(".settings-row", { has: live.getByText("GitHub", { exact: true }) }).first();
check("GitHub disponível mostra botão Conectar", await githubRow.getByRole("button", { name: "Conectar" }).count() === 1, await githubRow.innerText());
check("Figma continua não integrado", await live.locator(".settings-row", { has: live.getByText("Figma", { exact: true }) }).first().innerText().then((t) => t.includes("Ainda não integrado")));
check("Pasta local aparece na seção", await live.getByText("Pasta local", { exact: true }).count() === 1);
await live.screenshot({ path: "work/qa-settings-live.png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
await live.close();

// 2. mocked: already connected
const connected = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await connected.route("**/api/onboarding", (route) => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ github: { accountLabel: "rukafuu", scopes: ["repo", "read:user"], connectedAt: "2026-10-09T20:11:00.000Z" }, githubAvailable: true }),
}));
await openSettings(connected);
const connectedText = await connected.locator(".settings-row", { has: connected.getByText("GitHub", { exact: true }) }).first().innerText();
check("GitHub conectado mostra conta e escopos", connectedText.includes("@rukafuu") && connectedText.includes("repo"), connectedText.replace(/\s+/g, " "));
check("GitHub conectado mostra Autorizado", connectedText.includes("Autorizado em"));
await connected.screenshot({ path: "work/qa-settings-connected.png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
await connected.close();

// 3. mocked: device flow pending, started from the settings sheet itself
const pending = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pending.route("**/api/onboarding", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ github: null, githubAvailable: true }) }));
await pending.route("**/api/onboarding/github/device", (route) => route.fulfill({
  status: 201,
  contentType: "application/json",
  body: JSON.stringify({ id: "qa-device", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", interval: 5, expiresIn: 900 }),
}));
await openSettings(pending);
await pending.locator(".settings-row", { has: pending.getByText("GitHub", { exact: true }) }).first().getByRole("button", { name: "Conectar" }).click();
const pendingText = await pending.locator(".settings-row", { has: pending.getByText("GitHub", { exact: true }) }).first().innerText();
check("Device flow mostra código e Já autorizei", pendingText.includes("ABCD-1234") && pendingText.includes("Já autorizei"), pendingText.replace(/\s+/g, " "));
await pending.screenshot({ path: "work/qa-settings-pending.png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
await pending.close();

// 4. mocked: no client id on the server
const off = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await off.route("**/api/onboarding", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ github: null, githubAvailable: false }) }));
await openSettings(off);
const offRow = await off.locator(".settings-row", { has: off.getByText("GitHub", { exact: true }) }).first().innerText();
check("Sem client id mostra Não conectado", offRow.includes("Não conectado") && !offRow.includes("Conectar\n"), offRow.replace(/\s+/g, " "));
check("Sem client id mostra a nota do CLI", await off.locator(".settings-note").innerText().then((t) => t.includes("--github-client-id")));
await off.screenshot({ path: "work/qa-settings-off.png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
await off.close();

await browser.close();
console.log(results.join("\n"));
console.log(results.every((r) => r.startsWith("PASS")) ? "TODOS OS CHECKS PASSARAM" : "HÁ FALHAS");

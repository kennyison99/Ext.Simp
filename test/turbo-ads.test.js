import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("Turbo rules target ads without hiding the player or forum embed", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const manifest = JSON.parse(read("../manifest.json"));
  const rules = JSON.parse(read("../rules/turbo-ads.json"));
  const entry = manifest.content_scripts.find((item) => item.css?.includes("src/turbo-ads.css"));
  assert.deepEqual(entry.matches, ["https://turbo.cr/embed/*"]);
  assert.equal(entry.all_frames, true);
  assert.deepEqual(rules[0].condition.initiatorDomains, ["turbo.cr"]);
  assert.ok(!rules[0].condition.resourceTypes.includes("media"));
  assert.ok(!rules[0].condition.requestDomains.includes("turbo.cr"));
  const dom = new JSDOM('<html><head></head><body><div id="video-container"><video></video></div><div data-cl-overlay></div><iframe src="https://turbo.cr/embed/test"></iframe></body></html>');
  const { document } = dom.window;
  const overlay = document.createElement("iframe");
  document.documentElement.append(overlay);
  const style = document.createElement("style");
  style.textContent = read("../src/turbo-ads.css");
  document.head.append(style);
  assert.equal(dom.window.getComputedStyle(overlay).display, "none");
  assert.equal(dom.window.getComputedStyle(document.querySelector("[data-cl-overlay]")).display, "none");
  assert.notEqual(dom.window.getComputedStyle(document.querySelector("video")).display, "none");
  assert.notEqual(dom.window.getComputedStyle(document.querySelector("iframe[src]")).display, "none");
  dom.window.close();
});

#!/usr/bin/env node
/**
 * xaip-init
 *
 * Registers the XAIP Claude Code hook in ~/.claude/settings.json.
 * Idempotent: running twice is a no-op.
 *
 * Usage:
 *   npx xaip-claude-hook         # install
 *   npx xaip-claude-hook init    # install (explicit)
 *   npx xaip-claude-hook status  # show state
 *   npx xaip-claude-hook uninstall
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const HOOK_COMMAND = "xaip-claude-hook-run"; // resolved via npm global bin / PATH
const MATCHER = "mcp__.*";

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${SETTINGS_FILE}: ${e.message}`);
    console.error("Aborting to avoid overwriting invalid settings.");
    process.exit(1);
  }
}

function saveSettings(s) {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function hookEntryExists(settings, eventName) {
  const list = settings?.hooks?.[eventName];
  if (!Array.isArray(list)) return false;
  return list.some((entry) => {
    if (entry?.matcher !== MATCHER) return false;
    if (!Array.isArray(entry.hooks)) return false;
    return entry.hooks.some(
      (h) => typeof h?.command === "string" && h.command.includes(HOOK_COMMAND)
    );
  });
}

function addHookEntry(settings, eventName, timeout) {
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];
  settings.hooks[eventName].push({
    matcher: MATCHER,
    hooks: [{ type: "command", command: HOOK_COMMAND, timeout }],
  });
}

function removeHookEntries(settings, eventName) {
  const list = settings?.hooks?.[eventName];
  if (!Array.isArray(list)) return 0;
  const before = list.length;
  settings.hooks[eventName] = list.filter((entry) => {
    if (entry?.matcher !== MATCHER) return true;
    if (!Array.isArray(entry.hooks)) return true;
    return !entry.hooks.some(
      (h) => typeof h?.command === "string" && h.command.includes(HOOK_COMMAND)
    );
  });
  if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  return before - settings.hooks[eventName]?.length || before;
}

function install() {
  const settings = loadSettings();
  const preExists = hookEntryExists(settings, "PreToolUse");
  const postExists = hookEntryExists(settings, "PostToolUse");

  if (preExists && postExists) {
    console.log("✓ XAIP hook already installed.");
    printNext();
    return;
  }

  if (!preExists) addHookEntry(settings, "PreToolUse", 5);
  if (!postExists) addHookEntry(settings, "PostToolUse", 15);
  saveSettings(settings);

  console.log("✓ XAIP Claude Code hook installed.");
  console.log(`  ${SETTINGS_FILE}`);
  printNext();
}

function printNext() {
  console.log("");
  console.log("Next MCP tool call will emit a signed receipt to");
  console.log("  https://xaip-aggregator.kuma-github.workers.dev");
  console.log("");
  console.log("Your caller key is stored at ~/.xaip/hook-keys.json");
  console.log("Receipt log: ~/.xaip/hook.log");
  console.log("");
  console.log("Disable temporarily:  export XAIP_DISABLED=1");
  console.log("Uninstall:            npx xaip-claude-hook uninstall");
}

function status() {
  const settings = loadSettings();
  const pre = hookEntryExists(settings, "PreToolUse");
  const post = hookEntryExists(settings, "PostToolUse");
  console.log(`Settings: ${SETTINGS_FILE}`);
  console.log(`  PreToolUse hook:  ${pre ? "installed" : "missing"}`);
  console.log(`  PostToolUse hook: ${post ? "installed" : "missing"}`);
  const keyFile = path.join(os.homedir(), ".xaip", "hook-keys.json");
  if (fs.existsSync(keyFile)) {
    try {
      const k = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      console.log(`Caller DID: ${k.caller?.did ?? "(not yet generated)"}`);
      console.log(`Agents known: ${Object.keys(k.agents ?? {}).length}`);
    } catch {
      console.log("Caller key file exists but is unreadable.");
    }
  } else {
    console.log("Caller key: not yet generated (fires on first hook call)");
  }
}

function uninstall() {
  const settings = loadSettings();
  removeHookEntries(settings, "PreToolUse");
  removeHookEntries(settings, "PostToolUse");
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  saveSettings(settings);
  console.log("✓ XAIP hook removed from settings.");
  console.log("  (Keys + logs under ~/.xaip remain — delete manually if desired.)");
}

const cmd = (process.argv[2] || "install").toLowerCase();
switch (cmd) {
  case "install":
  case "init":
    install();
    break;
  case "status":
    status();
    break;
  case "uninstall":
  case "remove":
    uninstall();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error("Usage: xaip-claude-hook [install|status|uninstall]");
    process.exit(1);
}

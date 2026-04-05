import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(homedir(), ".config", "rwa-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const ENV_FILE = path.join(process.cwd(), ".env");

const KEY_ALIASES = {
  birdeye: "BIRDEYE_API_KEY",
  jupiter: "JUPITER_API_KEY",
  jup: "JUPITER_API_KEY",
  uniblock: "UNIBLOCK_API_KEY",
  odos: "ODOS_API_KEY",
  lifi: "LIFI_API_KEY",
  okx: "OKX_API_KEY",
  okxsecret: "OKX_SECRET_KEY",
  okxpassphrase: "OKX_API_PASSPHRASE",
  oneinch: "ONEINCH_API_KEY",
  "1inch": "ONEINCH_API_KEY",
  zerox: "ZEROX_API_KEY",
  "0x": "ZEROX_API_KEY",
  coingecko: "COINGECKO_API_KEY",
  defillama: "DEFILLAMA_API_KEY",
  llama: "DEFILLAMA_API_KEY"
};

const SENSITIVE_KEYS = new Set([
  "BIRDEYE_API_KEY",
  "JUPITER_API_KEY",
  "UNIBLOCK_API_KEY",
  "ODOS_API_KEY",
  "LIFI_API_KEY",
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_API_PASSPHRASE",
  "ONEINCH_API_KEY",
  "ZEROX_API_KEY",
  "COINGECKO_API_KEY",
  "COINGECKO_PRO_API_KEY",
  "DEFILLAMA_API_KEY"
]);

function normalizeKey(key) {
  const raw = String(key || "").trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();
  return KEY_ALIASES[lower] ?? raw.toUpperCase();
}

function readConfigFile() {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseDotEnv(content) {
  const entries = {};

  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

function readDotEnvFile() {
  try {
    if (!existsSync(ENV_FILE)) {
      return {};
    }

    return parseDotEnv(readFileSync(ENV_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeConfigFile(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export function getConfigPath() {
  return CONFIG_FILE;
}

export function getSetting(key, envKeys = []) {
  const normalized = normalizeKey(key);
  const candidates = [normalized, ...envKeys.map((item) => normalizeKey(item))].filter(Boolean);
  const dotEnv = readDotEnvFile();

  for (const candidate of candidates) {
    if (process.env[candidate]) {
      return process.env[candidate];
    }
  }

  for (const candidate of candidates) {
    if (dotEnv[candidate]) {
      return dotEnv[candidate];
    }
  }

  const config = readConfigFile();
  for (const candidate of candidates) {
    if (config[candidate]) {
      return config[candidate];
    }
  }

  return null;
}

export function hasSetting(key, envKeys = []) {
  return getSetting(key, envKeys) !== null;
}

export function setSetting(key, value) {
  const normalized = normalizeKey(key);
  if (!normalized) {
    throw new Error("Invalid config key");
  }

  const config = readConfigFile();
  config[normalized] = String(value);
  writeConfigFile(config);
  return {
    key: normalized,
    path: CONFIG_FILE
  };
}

export function unsetSetting(key) {
  const normalized = normalizeKey(key);
  if (!normalized) {
    throw new Error("Invalid config key");
  }

  const config = readConfigFile();
  const existed = Object.prototype.hasOwnProperty.call(config, normalized);
  delete config[normalized];
  writeConfigFile(config);

  return {
    key: normalized,
    existed,
    path: CONFIG_FILE
  };
}

export function listSettings(maskSensitive = true) {
  const config = readConfigFile();
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      value:
        maskSensitive && SENSITIVE_KEYS.has(key)
          ? `${String(value).slice(0, 4)}...${String(value).slice(-4)}`
          : value
    }));
}

export function normalizeConfigKey(key) {
  return normalizeKey(key);
}

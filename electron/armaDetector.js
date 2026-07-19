// ─── Arma 3 Auto-Detection ────────────────────────────────────────────────────
// Detects Arma 3 installation via: registry -> Steam libraryfolders.vdf -> common paths

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ARMA_APPID = '107410';

// ─── Registry Detection ──────────────────────────────────────────────────────
function detectFromRegistry() {
  const keys = [
    'HKLM:\\SOFTWARE\\Wow6432Node\\Valve\\Steam',
    'HKLM:\\SOFTWARE\\Valve\\Steam',
    'HKCU:\\Software\\Valve\\Steam',
  ];

  for (const key of keys) {
    try {
      const result = execSync(`reg query "${key}" /v InstallPath 2>nul`, { encoding: 'utf8' });
      const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) return match[1].trim();
    } catch (_) {}
  }
  return null;
}

// ─── Parse Steam libraryfolders.vdf ──────────────────────────────────────────
function parseLibraryFolders(steamPath) {
  const paths = [];
  const vdfLocations = [
    path.join(steamPath, 'steamapps', 'libraryfolders.vdf'),
    path.join(steamPath, 'config', 'libraryfolders.vdf'),
  ];

  for (const vdfPath of vdfLocations) {
    try {
      const content = fs.readFileSync(vdfPath, 'utf8');
      // Match "path" entries in the new VDF format
      const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/gi);
      for (const m of pathMatches) {
        const p = m[1].replace(/\\\\/g, '\\');
        const steamApps = path.join(p, 'steamapps');
        if (!paths.includes(steamApps)) paths.push(steamApps);
      }
      if (paths.length > 0) break;
    } catch (_) {}
  }

  return paths;
}

// ─── Find Arma 3 in Steam library ────────────────────────────────────────────
function findArmaInLibrary(steamAppsPath) {
  try {
    const acfFile = path.join(steamAppsPath, `appmanifest_${ARMA_APPID}.acf`);
    if (!fs.existsSync(acfFile)) return null;

    const content = fs.readFileSync(acfFile, 'utf8');
    const match = content.match(/"installdir"\s+"(.+?)"/i);
    if (match) {
      return path.join(steamAppsPath, 'common', match[1]);
    }
  } catch (_) {}
  return null;
}

// ─── Main Detection ──────────────────────────────────────────────────────────
function detectArma3() {
  // Step 1: Try registry
  const steamPath = detectFromRegistry();
  if (steamPath) {
    // Step 2: Parse library folders
    const libraries = parseLibraryFolders(steamPath);
    // Add the default library
    const defaultLib = path.join(steamPath, 'steamapps');
    if (!libraries.includes(defaultLib)) libraries.unshift(defaultLib);

    // Step 3: Search each library for Arma 3
    for (const lib of libraries) {
      const armaPath = findArmaInLibrary(lib);
      if (armaPath && fs.existsSync(armaPath)) {
        return armaPath;
      }
    }
  }

  // Step 4: Common fallback paths
  const commonPaths = [
    path.join('C:', 'Program Files (x86)', 'Steam', 'steamapps', 'common', 'Arma 3'),
    path.join('C:', 'Program Files', 'Steam', 'steamapps', 'common', 'Arma 3'),
    path.join('D:', 'SteamLibrary', 'steamapps', 'common', 'Arma 3'),
    path.join('D:', 'Steam', 'steamapps', 'common', 'Arma 3'),
    path.join('D:', 'Games', 'Arma 3'),
    path.join('E:', 'SteamLibrary', 'steamapps', 'common', 'Arma 3'),
    path.join('E:', 'Games', 'Arma 3'),
    path.join('E:', 'Arma 3'),
    path.join('F:', 'SteamLibrary', 'steamapps', 'common', 'Arma 3'),
    path.join('F:', 'Games', 'Arma 3'),
    path.join('F:', 'Arma 3'),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

// ─── Detect Arma 3 Documents Path ────────────────────────────────────────────
function detectArmaDocuments() {
  const os = require('os');
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Documents', 'Arma 3'),
    path.join(home, 'OneDrive', 'Documents', 'Arma 3'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return path.join(home, 'Documents', 'Arma 3');
}

// ─── Find most recent RPT log ────────────────────────────────────────────────
function findLatestRptLog(armaDocsPath) {
  const localAppData = path.join(process.env.LOCALAPPDATA || '', 'Arma 3');
  const searchPaths = [localAppData, armaDocsPath];

  let latestFile = null;
  let latestMtime = 0;

  for (const dir of searchPaths) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.match(/arma3.*\.rpt$/i)) {
          const full = path.join(dir, f);
          const stat = fs.statSync(full);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestFile = full;
          }
        }
      }
    } catch (_) {}
  }

  return latestFile;
}

module.exports = {
  detectArma3,
  detectArmaDocuments,
  findLatestRptLog,
};

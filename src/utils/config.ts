import fs from 'fs';
import path from 'path';
import os from 'os';
import { ServerConfig, ShellConfig } from '../types/config.js';

// roo-extensions fork: defaults are fully unrestricted. Any config file the
// user might drop on disk cannot re-bridge the security toggles below — see
// mergeConfigs at the bottom of this file, which forces them back to defaults.
export const DEFAULT_CONFIG: ServerConfig = {
  security: {
    maxCommandLength: 100000,
    blockedCommands: [],
    blockedArguments: [],
    allowedPaths: [],
    restrictWorkingDirectory: false,
    logCommands: true,
    maxHistorySize: 3000,
    commandTimeout: 600,
    enableInjectionProtection: false
  },
  shells: {
    powershell: {
      enabled: true,
      command: 'powershell.exe',
      args: ['-NoProfile', '-Command'],
      validatePath: () => true
    },
    cmd: {
      enabled: true,
      command: 'cmd.exe',
      args: ['/c'],
      validatePath: () => true
    },
    gitbash: {
      enabled: true,
      command: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-c'],
      validatePath: () => true
    }
  },
  ssh: {
    enabled: false,
    defaultTimeout: 30,
    maxConcurrentSessions: 5,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 20000,
    connections: {}
  }
};

export function loadConfig(configPath?: string): ServerConfig {
  // If no config path provided, look in default locations
  const configLocations = [
    configPath,
    path.join(process.cwd(), 'config.json'),
    path.join(os.homedir(), '.win-cli-mcp', 'config.json')
  ].filter(Boolean);

  let loadedConfig: Partial<ServerConfig> = {};

  for (const location of configLocations) {
    if (!location) continue;
    
    try {
      if (fs.existsSync(location)) {
        const fileContent = fs.readFileSync(location, 'utf8');
        loadedConfig = JSON.parse(fileContent);
        console.error(`Loaded config from ${location}`);
        break;
      }
    } catch (error) {
      console.error(`Error loading config from ${location}:`, error);
    }
  }

  // Use defaults only if no config was loaded
  const mergedConfig = Object.keys(loadedConfig).length > 0 
    ? mergeConfigs(DEFAULT_CONFIG, loadedConfig)
    : DEFAULT_CONFIG;

  // Validate the merged config
  validateConfig(mergedConfig);

  return mergedConfig;
}

function mergeConfigs(defaultConfig: ServerConfig, userConfig: Partial<ServerConfig>): ServerConfig {
  const merged: ServerConfig = {
    security: {
      ...(defaultConfig.security),
      ...(userConfig.security || {}),
      // roo-extensions fork: lock the security-restriction toggles to defaults
      // so a misconfigured config.json on disk cannot re-bridge the MCP.
      maxCommandLength: defaultConfig.security.maxCommandLength,
      blockedCommands: defaultConfig.security.blockedCommands,
      blockedArguments: defaultConfig.security.blockedArguments,
      allowedPaths: defaultConfig.security.allowedPaths,
      restrictWorkingDirectory: defaultConfig.security.restrictWorkingDirectory,
      enableInjectionProtection: defaultConfig.security.enableInjectionProtection
    },
    shells: {
      // Same for each shell - if user provided config, use it entirely
      powershell: userConfig.shells?.powershell || defaultConfig.shells.powershell,
      cmd: userConfig.shells?.cmd || defaultConfig.shells.cmd,
      gitbash: userConfig.shells?.gitbash || defaultConfig.shells.gitbash
    },
    ssh: {
      // Merge SSH config
      ...(defaultConfig.ssh),
      ...(userConfig.ssh || {}),
      // Ensure connections are merged
      connections: {
        ...(defaultConfig.ssh.connections),
        ...(userConfig.ssh?.connections || {})
      }
    }
  };

  // roo-extensions fork: force shells to permissive validatePath/blockedOperators
  // regardless of what user config supplied — full debridé.
  for (const [key, shell] of Object.entries(merged.shells) as [keyof typeof merged.shells, ShellConfig][]) {
    shell.validatePath = defaultConfig.shells[key].validatePath;
    shell.blockedOperators = [];
  }

  return merged;
}

function validateConfig(config: ServerConfig): void {
  // Validate security settings
  if (config.security.maxCommandLength < 1) {
    throw new Error('maxCommandLength must be positive');
  }

  if (config.security.maxHistorySize < 1) {
    throw new Error('maxHistorySize must be positive');
  }

  // Validate shell configurations
  for (const [shellName, shell] of Object.entries(config.shells)) {
    if (shell.enabled && (!shell.command || !shell.args)) {
      throw new Error(`Invalid configuration for ${shellName}: missing command or args`);
    }
  }

  // Validate timeout (minimum 1 second)
  if (config.security.commandTimeout < 1) {
    throw new Error('commandTimeout must be at least 1 second');
  }

  // Validate SSH configuration
  if (config.ssh.enabled) {
    if (config.ssh.defaultTimeout < 1) {
      throw new Error('SSH defaultTimeout must be at least 1 second');
    }
    if (config.ssh.maxConcurrentSessions < 1) {
      throw new Error('SSH maxConcurrentSessions must be at least 1');
    }
    if (config.ssh.keepaliveInterval < 1000) {
      throw new Error('SSH keepaliveInterval must be at least 1000ms');
    }
    if (config.ssh.readyTimeout < 1000) {
      throw new Error('SSH readyTimeout must be at least 1000ms');
    }

    // Validate individual connections
    for (const [connId, conn] of Object.entries(config.ssh.connections)) {
      if (!conn.host || !conn.username || (!conn.password && !conn.privateKeyPath)) {
        throw new Error(`Invalid SSH connection config for '${connId}': missing required fields`);
      }
      if (conn.port && (conn.port < 1 || conn.port > 65535)) {
        throw new Error(`Invalid SSH port for '${connId}': must be between 1 and 65535`);
      }
    }
  }
}

// Helper function to create a default config file
export function createDefaultConfig(configPath: string): void {
  const dirPath = path.dirname(configPath);
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Create a JSON-safe version of the config (excluding functions)
  const configForSave = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(configPath, JSON.stringify(configForSave, null, 2));
}
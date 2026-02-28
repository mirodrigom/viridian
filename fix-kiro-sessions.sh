#!/bin/bash
# Quick fix for Kiro session detection

echo "Applying Kiro session detection fix..."

# 1. Add existsSync import to sessions.ts
sed -i "s/import { join } from 'path';/import { join } from 'path';\nimport { existsSync } from 'fs';/" server/src/ws/sessions.ts

# 2. Add KIRO_DIR constant
sed -i "s/const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');/const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');\nconst KIRO_DIR = join(getHomeDir(), '.kiro', 'chat');/" server/src/ws/sessions.ts

# 3. Update watcher to watch both directories
sed -i "s/const watcher = watch(CLAUDE_DIR, {/\/\/ Build list of directories to watch\n  const dirsToWatch: string[] = [CLAUDE_DIR];\n  if (existsSync(KIRO_DIR)) {\n    dirsToWatch.push(KIRO_DIR);\n    console.log('[sessions-ws] Kiro session directory detected, will watch for changes');\n  }\n\n  const watcher = watch(dirsToWatch, {/" server/src/ws/sessions.ts

echo "Done! Kiro sessions will now appear in the sidebar."
echo "Restart the server for changes to take effect: pnpm dev:server"

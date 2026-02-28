#!/bin/bash
# Kiro Skill: Sync Claude Config
# Description: Copy .claude agents and plans to .kiro for Viridian integration

set -e

SOURCE_DIR=".claude"
TARGET_DIR=".kiro"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: $SOURCE_DIR directory not found"
  exit 1
fi

mkdir -p "$TARGET_DIR/agents" "$TARGET_DIR/plans"

if [ -d "$SOURCE_DIR/agents" ]; then
  cp -r "$SOURCE_DIR/agents/"* "$TARGET_DIR/agents/" 2>/dev/null || true
  echo "✓ Copied agents"
fi

if [ -d "$SOURCE_DIR/plans" ]; then
  cp -r "$SOURCE_DIR/plans/"* "$TARGET_DIR/plans/" 2>/dev/null || true
  echo "✓ Copied plans"
fi

if [ -f "$SOURCE_DIR/settings.local.json" ]; then
  cp "$SOURCE_DIR/settings.local.json" "$TARGET_DIR/settings.local.json"
  echo "✓ Copied settings"
fi

echo "✓ Sync complete: .claude → .kiro"

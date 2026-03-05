import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const gameJamNodes: SerializedNode[] = [
  {
    id: 'agent-jam-lead',
    type: 'agent',
    position: { x: 350, y: 0 },
    data: {
      nodeType: 'agent', label: 'Jam Lead',
      description: 'Rapid prototyping leader for game jams. Focuses on quick iteration, MVP delivery, and scope management within tight time constraints.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a game jam lead focused on rapid prototyping. Ship a playable game within an extremely tight deadline.

Jam philosophy: Scope ruthlessly — cut everything not core to game feel. Prototype the core mechanic FIRST. Use placeholder art until the mechanic is proven. Ship early, iterate fast. "Good enough" beats "perfect."

Scope limits: Maximum 3 core mechanics (ideally 1), maximum 5 entity types, one level/scene, no save system or settings menu — focus on the core loop.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-prototype',
    type: 'subagent',
    position: { x: 350, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Prototype Builder',
      description: 'Rapidly implements game mechanics and MVP features. Prioritizes speed and iteration over code quality for jam contexts.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a rapid prototyping specialist for game jams. Speed and iteration are your priorities — get something playable as fast as possible.

## Approach
- Use the simplest possible implementation that demonstrates the mechanic
- Hardcode values first, extract to config later IF there's time
- Copy-paste is acceptable — DRY can wait until after the jam
- Use built-in engine features heavily — don't reinvent physics, collision, or rendering
- Implement the "golden path" first — the one scenario where the game works perfectly
- Add edge cases only for game-breaking bugs (crash, softlock, infinite loop)

## Rapid Implementation Patterns
- Game state: simple enum + switch statement, no complex state machine needed
- Collision: use built-in engine colliders, not custom physics
- UI: minimal — score counter, timer, game over screen
- Audio: use free sound effects libraries, implement last
- Input: support keyboard first, add gamepad if time permits`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Rapidly prototype game mechanics with MVP focus',
    },
  },
  {
    id: 'skill-game-loop',
    type: 'skill',
    position: { x: 50, y: 300 },
    data: {
      nodeType: 'skill', label: 'Game Loop',
      description: 'Scaffolds a basic game loop structure with initialization, update, render, and input handling phases.',
      command: '/game-loop',
      promptTemplate: `Scaffold a basic game loop structure for rapid prototyping. Steps:
1. Detect the game engine or framework being used (or default to a vanilla JS/canvas setup)
2. Create the core game loop with proper phases: init → input → update → render
3. Set up a fixed timestep update with variable render interpolation
4. Add basic input handling (keyboard events, mouse/touch position tracking)
5. Create a minimal game state object with scene management (menu, playing, game-over)
6. Add a simple entity spawning/destroying pattern
7. Include a basic collision check helper (AABB or circle-circle)
8. Output the scaffolded files ready for the prototype builder to add game-specific logic`,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    },
  },
  {
    id: 'skill-asset-finder',
    type: 'skill',
    position: { x: 650, y: 300 },
    data: {
      nodeType: 'skill', label: 'Asset Finder',
      description: 'Searches for free and CC0 licensed game assets including sprites, sounds, and music for rapid prototyping.',
      command: '/find-assets',
      promptTemplate: `Find free/CC0 game assets for the current project. Steps:
1. Identify what asset types are needed based on the game concept (sprites, tilesets, sounds, music, fonts)
2. Search for appropriate free asset sources: OpenGameArt.org, Kenney.nl, itch.io free assets, freesound.org
3. Recommend specific asset packs that match the game's art style and theme
4. Check license compatibility — prefer CC0/public domain, flag any attribution requirements
5. Provide download URLs and integration instructions for each recommended asset
6. Suggest placeholder alternatives if exact matches aren't available (colored rectangles, simple shapes)
7. Note any asset modifications needed (resizing, recoloring, format conversion)`,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    },
  },
];

const gameJamEdges: SerializedEdge[] = [
  edge('agent-jam-lead', 'sub-prototype', 'delegation'),
  edge('agent-jam-lead', 'skill-game-loop', 'skill-usage'),
  edge('agent-jam-lead', 'skill-asset-finder', 'skill-usage'),
  edge('sub-prototype', 'skill-game-loop', 'skill-usage'),
];

export const gameJamStarter: GraphTemplate = {
  id: 'game-jam-starter',
  name: 'Game Jam Starter',
  description: 'Lean game jam setup with rapid prototyping subagent, game loop scaffolding, and free asset discovery — ship a playable game fast.',
  category: 'gaming',
  nodes: gameJamNodes,
  edges: gameJamEdges,
};

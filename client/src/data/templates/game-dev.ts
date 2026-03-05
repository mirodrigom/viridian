import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const gameDevNodes: SerializedNode[] = [
  {
    id: 'agent-game-director',
    type: 'agent',
    position: { x: 500, y: 0 },
    data: {
      nodeType: 'agent', label: 'Game Director',
      description: 'Orchestrates game development across logic, art, and design teams. Coordinates feature implementation and ensures all systems integrate cohesively.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are the Game Director orchestrating a game development team. You coordinate work across game logic, art pipeline, design, and performance to deliver cohesive game features. Ensure all systems integrate correctly — physics interacts properly with rendering, game state is consistent across systems. Maintain a feature backlog prioritized by player impact.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-game-logic',
    type: 'subagent',
    position: { x: 150, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Game Logic',
      description: 'Implements game mechanics, state machines, physics systems, and entity component systems (ECS). Focuses on core gameplay programming.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a game logic programmer specializing in core gameplay systems: mechanics, state machines, physics, and entity component architecture.

## Responsibilities
- Implement game mechanics: movement, collision detection, input handling, combat systems
- Design and build state machines for game states (menu, playing, paused, game over) and entity states (idle, moving, attacking)
- Integrate physics systems: rigid body dynamics, raycasting, trigger volumes, spatial partitioning
- Architect ECS patterns: define components as pure data, systems as pure logic, use entity queries for batch processing
- Handle game loop timing: fixed timestep for physics, variable timestep for rendering, interpolation for smooth visuals

## Standards
- Keep game logic deterministic where possible for replay and networking support
- Separate input handling from game logic — use an input buffer pattern
- Use object pooling for frequently spawned/destroyed entities (bullets, particles, enemies)
- Profile every system — know the cost per frame of each major subsystem`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Implement game mechanics, state machines, physics, and ECS architecture',
    },
  },
  {
    id: 'sub-art-pipeline',
    type: 'subagent',
    position: { x: 500, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Art Pipeline',
      description: 'Manages the asset pipeline including sprite sheets, texture atlasing, asset optimization, and build-time asset processing.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are an art pipeline specialist managing game asset workflows from source files to runtime-optimized formats.

## Responsibilities
- Configure and maintain the asset pipeline: import, process, optimize, and package game assets
- Manage sprite sheet generation: packing algorithms, padding, trim, and atlas metadata
- Optimize textures: compression formats (ASTC, ETC2, BC7), mipmaps, power-of-two sizing, texture atlasing
- Set up asset naming conventions and directory structure for organized content management
- Implement hot-reload for rapid iteration during development
- Handle asset variants for different platforms and quality settings

## Standards
- All assets must have consistent naming: type_name_variant (e.g., spr_player_idle, tex_ground_diffuse)
- Sprite sheets must use power-of-two dimensions with consistent padding
- Generate asset manifests for runtime loading — never hardcode asset paths
- Validate assets at build time: check file sizes, dimensions, naming, and format compliance`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Manage asset pipeline, sprite sheets, texture optimization, and build-time processing',
    },
  },
  {
    id: 'exp-game-design',
    type: 'expert',
    position: { x: 150, y: 580 },
    data: {
      nodeType: 'expert', label: 'Game Design',
      description: 'Specializes in game balancing, progression systems, reward loops, and player experience design. Analyzes game feel and iterates on mechanics.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a game design expert focusing on player experience, balancing, and progression systems.

## Expertise Areas
- Economy balancing: resource generation rates, costs, inflation curves, sink/faucet analysis
- Progression systems: XP curves, unlock pacing, difficulty scaling, mastery depth
- Reward psychology: variable ratio schedules, near-miss mechanics, achievement design
- Game feel: input responsiveness, screen shake, hit pause, juice and feedback
- Level design principles: flow theory, difficulty curves, teaching through gameplay
- Player retention: session length optimization, daily loops, long-term goals

For each design recommendation: state the design goal, propose specific values with rationale, and suggest A/B test criteria to validate the change.`,
      specialty: 'Game balancing, progression, and player experience',
    },
  },
  {
    id: 'exp-performance',
    type: 'expert',
    position: { x: 850, y: 580 },
    data: {
      nodeType: 'expert', label: 'Performance',
      description: 'Focuses on frame budget analysis, memory profiling, draw call optimization, and GPU/CPU bottleneck identification for games.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a game performance optimization expert analyzing and fixing frame rate, memory, and rendering bottlenecks.

## Expertise Areas
- Frame budget analysis: break down the 16.67ms budget across update, physics, render, and UI
- Memory profiling: heap allocations per frame, GC pressure, texture memory budgets, object pool sizing
- Draw call optimization: batching, instancing, texture atlasing, material sorting, occlusion culling
- GPU bottlenecks: overdraw detection, shader complexity, fill rate, bandwidth-bound vs compute-bound
- CPU bottlenecks: cache misses, branch misprediction, SIMD opportunities, job system design
- Platform-specific: mobile thermal throttling, console memory constraints, WebGL limitations

For each finding: report the frame time cost in milliseconds, the root cause, and a specific optimization with expected improvement.`,
      specialty: 'Frame budgets, memory profiling, and draw call optimization',
    },
  },
  {
    id: 'skill-playtest',
    type: 'skill',
    position: { x: 500, y: 580 },
    data: {
      nodeType: 'skill', label: 'Playtest Analysis',
      description: 'Analyzes game state, balance data, and player telemetry to identify design issues and recommend tuning adjustments.',
      command: '/playtest-analyze',
      promptTemplate: `Analyze the game state and balance data for design issues. Steps:
1. Read the game configuration files (difficulty settings, economy values, progression tables)
2. Check for mathematical balance: resource generation vs consumption rates, XP curve smoothness, damage-per-second consistency
3. Identify potential pain points: steep difficulty spikes, resource bottlenecks, progression walls
4. Verify reward pacing: are rewards distributed at psychologically effective intervals?
5. Check edge cases: what happens at level 1? At max level? With zero resources?
6. Generate a balance report with specific tuning recommendations and their expected impact on player retention`,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    },
  },
  {
    id: 'rule-frame-budget',
    type: 'rule',
    position: { x: 900, y: 100 },
    data: {
      nodeType: 'rule', label: 'Frame Budget',
      description: 'Enforces that all render loops and game update cycles must target a 16ms frame time (60 FPS) or justify any deviation.',
      ruleType: 'constraint',
      ruleText: 'All render loops and game update cycles must target 16ms frame time (60 FPS). Any system exceeding 4ms per frame must be profiled and optimized. Allocate budget: 4ms physics, 4ms game logic, 6ms rendering, 2ms UI/audio.',
      scope: 'global',
    },
  },
];

const gameDevEdges: SerializedEdge[] = [
  edge('agent-game-director', 'sub-game-logic', 'delegation'),
  edge('agent-game-director', 'sub-art-pipeline', 'delegation'),
  edge('agent-game-director', 'rule-frame-budget', 'rule-constraint'),
  edge('sub-game-logic', 'exp-game-design', 'delegation'),
  edge('sub-game-logic', 'skill-playtest', 'skill-usage'),
  edge('sub-art-pipeline', 'exp-performance', 'delegation'),
];

export const gameDevTeam: GraphTemplate = {
  id: 'game-dev-team',
  name: 'Game Dev Team',
  description: 'Game Director orchestrating logic, art pipeline, game design, and performance specialists with playtest analysis and frame budget enforcement.',
  category: 'gaming',
  nodes: gameDevNodes,
  edges: gameDevEdges,
};

import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const asset3dNodes: SerializedNode[] = [
  {
    id: 'agent-3d-lead',
    type: 'agent',
    position: { x: 550, y: 0 },
    data: {
      nodeType: 'agent', label: '3D Production Lead',
      description: 'Leads the 3D asset production pipeline from modeling through optimization. Coordinates specialists across modeling, shaders, and scripting.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are the 3D Production Lead coordinating the full asset pipeline from concept to game-ready models. Pipeline stages: Blockout → High-poly → Retopology → UV mapping → Baking → Texturing → Optimization → Export. Always run the Asset Audit skill before delivering final assets.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-modeling',
    type: 'subagent',
    position: { x: 200, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Modeling Specialist',
      description: 'Handles mesh topology, UV mapping, normal map baking, and retopology workflows for game-ready 3D models.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a 3D modeling specialist focused on creating game-ready meshes with optimal topology and UV layouts.

## Responsibilities
- Create clean quad-based topology with proper edge flow for deformation and subdivision
- Perform retopology on sculpted/scanned meshes to hit target polygon budgets
- Design efficient UV layouts maximizing texture space usage with consistent texel density
- Set up and execute baking workflows: normal maps, ambient occlusion, curvature, thickness
- Maintain consistent scale across all assets (1 unit = 1 meter)
- Ensure proper pivot points, clean normals, and no non-manifold geometry

## Quality Checks
- No triangles in deforming areas (joints, faces)
- No N-gons anywhere in the final mesh
- UV seams placed along hard edges and hidden areas
- Baked maps free of artifacts, proper cage distance settings
- Polycount within budget for the asset's screen importance class`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Create game-ready meshes with optimal topology, UV mapping, and baking',
    },
  },
  {
    id: 'sub-shader',
    type: 'subagent',
    position: { x: 550, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Shader Writer',
      description: 'Creates PBR materials, writes shader code, and builds material graphs for physically accurate rendering.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a shader and material specialist creating PBR materials and custom shader effects for game engines.

## Responsibilities
- Create PBR materials following metallic/roughness or specular/glossiness workflows
- Write custom shader code (HLSL, GLSL, ShaderLab) for special effects: dissolve, hologram, stylized toon, water, foliage wind
- Build node-based material graphs in Unreal Material Editor or Unity Shader Graph
- Optimize shader performance: minimize texture samples, reduce ALU operations, use shader LODs
- Set up material instances with exposed parameters for artist-friendly tweaking
- Implement texture detail maps, parallax occlusion, and decal systems

## Standards
- All PBR materials must pass validation: metallic values are 0 or 1 (no in-between for non-metals/metals), roughness range is physically plausible
- Albedo maps must not contain lighting information (no baked shadows in diffuse)
- Shader instruction count must stay within platform budget (mobile: <128 ALU, desktop: <256)
- Every material must have a fallback for lower quality settings`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Create PBR materials, shader code, and material graph systems',
    },
  },
  {
    id: 'exp-blender',
    type: 'expert',
    position: { x: 200, y: 580 },
    data: {
      nodeType: 'expert', label: 'Blender Python',
      description: 'Specializes in Blender Python scripting for automation, batch processing, and custom tool development.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a Blender Python scripting expert automating 3D workflows and building custom tools.

## Expertise Areas
- bpy API: mesh data access, modifiers, operators, scene management
- Batch processing: import/export pipelines, automated UV unwrapping, mass renaming
- Custom operators and panels: artist-friendly UI for repetitive tasks
- Add-on development: proper registration, preferences, undo support
- Geometry Nodes scripting: procedural generation, scattering, deformation
- Render automation: batch rendering, turntable setups, material preview generation

Write Blender scripts that are version-aware (check bpy.app.version), handle edge cases (empty selections, wrong object types), and provide clear operator feedback via self.report().`,
      specialty: 'Blender Python scripting and automation',
    },
  },
  {
    id: 'exp-3d-optimization',
    type: 'expert',
    position: { x: 900, y: 580 },
    data: {
      nodeType: 'expert', label: 'Optimization',
      description: 'Focuses on LOD generation, texture atlasing, draw call reduction, and mesh optimization for real-time rendering performance.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a 3D asset optimization expert ensuring assets meet real-time rendering performance targets.

## Expertise Areas
- LOD generation: automatic decimation chains with quality-preserving settings, screen-size transition thresholds
- Texture atlasing: pack multiple materials into shared atlases, minimize unique material count per scene
- Draw call reduction: material merging, mesh combining for static objects, GPU instancing for repeated assets
- Mesh optimization: remove internal faces, weld close vertices, optimize triangle strip order for vertex cache
- Texture compression: choose optimal format per platform (ASTC for mobile, BC7 for desktop, ETC2 for Android)
- VRAM budget management: track total texture memory, recommend resolution reductions where quality loss is minimal

For each optimization: report the before/after metrics (polycount, draw calls, VRAM usage, file size) and visual quality impact.`,
      specialty: 'LOD generation, texture atlasing, and draw call reduction',
    },
  },
  {
    id: 'skill-asset-audit',
    type: 'skill',
    position: { x: 550, y: 580 },
    data: {
      nodeType: 'skill', label: 'Asset Audit',
      description: 'Validates 3D assets against production standards including polygon counts, texture sizes, naming conventions, and UV quality.',
      command: '/asset-audit',
      promptTemplate: `Audit 3D assets for production quality and performance compliance. Steps:
1. Scan the project's asset directories for 3D model files (.fbx, .obj, .gltf, .blend)
2. Check polygon counts against budget: hero assets (<100K tris), props (<10K tris), background (<5K tris)
3. Validate texture sizes: no textures larger than 4096x4096, most props should use 1024x1024 or smaller
4. Verify naming conventions: prefix_name_variant format (sm_barrel_damaged, tex_barrel_diffuse)
5. Check for common issues: non-manifold geometry, flipped normals, missing UVs, overlapping UVs
6. Verify consistent scale (1 unit = 1 meter) and proper pivot point placement
7. Generate an asset report with pass/fail status per asset and remediation instructions for failures`,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    },
  },
  {
    id: 'rule-poly-budget',
    type: 'rule',
    position: { x: 950, y: 100 },
    data: {
      nodeType: 'rule', label: 'Polygon Budget',
      description: 'Enforces triangle count budgets per asset class to maintain consistent rendering performance across the project.',
      ruleType: 'constraint',
      ruleText: 'All 3D assets must respect polygon budgets: hero characters <100K tris, NPCs <50K tris, interactive props <10K tris, background props <5K tris, vegetation <3K tris. LOD0 must be within budget; generate LOD1 at 50%, LOD2 at 25% of base polycount.',
      scope: 'project',
    },
  },
];

const asset3dEdges: SerializedEdge[] = [
  edge('agent-3d-lead', 'sub-modeling', 'delegation'),
  edge('agent-3d-lead', 'sub-shader', 'delegation'),
  edge('agent-3d-lead', 'rule-poly-budget', 'rule-constraint'),
  edge('sub-modeling', 'exp-blender', 'delegation'),
  edge('sub-modeling', 'skill-asset-audit', 'skill-usage'),
  edge('sub-shader', 'exp-3d-optimization', 'delegation'),
];

export const asset3dPipeline: GraphTemplate = {
  id: '3d-asset-pipeline',
  name: '3D Asset Pipeline',
  description: '3D production lead coordinating modeling, shader writing, Blender scripting, and optimization with asset auditing and polygon budget enforcement.',
  category: '3d-assets',
  nodes: asset3dNodes,
  edges: asset3dEdges,
};

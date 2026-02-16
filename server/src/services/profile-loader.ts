/**
 * ProfileLoader - Loads built-in autopilot profiles from JSON configuration files.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current module directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types imported from autopilot-profiles.ts
export interface SubagentDefinition {
  key: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
}

export interface McpServerReference {
  name: string;
  requiredTools?: string[];
}

export interface AutopilotProfile {
  id: string;
  userId: number | null;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  isBuiltin: boolean;
  createdAt?: string;
  // Extended fields
  category: string;
  tags: string[];
  subagents: SubagentDefinition[];
  mcpServers: McpServerReference[];
  appendSystemPrompt: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  icon: string | null;
  difficulty: string | null;
}

// Profile data structure as stored in JSON files (without database-specific fields)
interface ProfileData {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  category: string;
  tags: string[];
  subagents: SubagentDefinition[];
  mcpServers: McpServerReference[];
  appendSystemPrompt: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  icon: string | null;
  difficulty: string | null;
}

export class ProfileLoader {
  private static profiles: AutopilotProfile[] = [];
  private static loaded = false;

  /**
   * Loads all built-in profiles from JSON files organized by category.
   */
  static loadBuiltinProfiles(): AutopilotProfile[] {
    if (this.loaded) {
      return this.profiles;
    }

    const profilesDir = join(__dirname, '..', 'data', 'profiles');

    if (!existsSync(profilesDir)) {
      console.warn(`Profile directory not found: ${profilesDir}`);
      return [];
    }

    const categories = ['general', 'development', 'testing', 'devops', 'domain', 'orchestrator'];
    const loadedProfiles: AutopilotProfile[] = [];

    for (const category of categories) {
      const categoryDir = join(profilesDir, category);

      if (!existsSync(categoryDir)) {
        console.warn(`Category directory not found: ${categoryDir}`);
        continue;
      }

      try {
        const files = readdirSync(categoryDir).filter(file => file.endsWith('.json'));

        for (const file of files) {
          const filePath = join(categoryDir, file);
          const profile = this.loadProfileFromFile(filePath);

          if (profile) {
            loadedProfiles.push(profile);
          }
        }
      } catch (error) {
        console.error(`Error reading category directory ${category}:`, error);
      }
    }

    this.profiles = loadedProfiles;
    this.loaded = true;

    console.log(`Loaded ${loadedProfiles.length} built-in profiles`);
    return this.profiles;
  }

  /**
   * Loads a single profile from a JSON file and converts it to the full AutopilotProfile format.
   */
  private static loadProfileFromFile(filePath: string): AutopilotProfile | null {
    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const profileData: ProfileData = JSON.parse(fileContent);

      // Validate required fields
      if (!profileData.id || !profileData.name || !profileData.role) {
        console.error(`Invalid profile data in ${filePath}: missing required fields`);
        return null;
      }

      // Validate category matches directory structure
      const expectedCategory = filePath.split('/').slice(-2, -1)[0]; // Get parent directory name
      if (profileData.category !== expectedCategory) {
        console.warn(`Category mismatch in ${filePath}: expected '${expectedCategory}', got '${profileData.category}'`);
      }

      // Convert ProfileData to AutopilotProfile with database-specific fields
      const profile: AutopilotProfile = {
        ...profileData,
        userId: null,        // Built-in profiles have no user owner
        isBuiltin: true,     // Mark as built-in
        // createdAt will be added when needed
      };

      return profile;
    } catch (error) {
      console.error(`Error loading profile from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Validates a profile's structure and required fields.
   */
  private static validateProfile(profile: ProfileData): boolean {
    // Required string fields
    const requiredStrings = ['id', 'name', 'role', 'description', 'systemPrompt', 'category'];
    for (const field of requiredStrings) {
      if (!profile[field as keyof ProfileData] || typeof profile[field as keyof ProfileData] !== 'string') {
        return false;
      }
    }

    // Required arrays
    if (!Array.isArray(profile.allowedTools) || !Array.isArray(profile.disallowedTools)) {
      return false;
    }

    if (!Array.isArray(profile.tags) || !Array.isArray(profile.subagents) || !Array.isArray(profile.mcpServers)) {
      return false;
    }

    // Validate subagents structure
    for (const subagent of profile.subagents) {
      if (!subagent.key || !subagent.description || !subagent.prompt) {
        return false;
      }
    }

    // Validate MCP servers structure
    for (const mcpServer of profile.mcpServers) {
      if (!mcpServer.name) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get profiles by category.
   */
  static getProfilesByCategory(category: string): AutopilotProfile[] {
    const profiles = this.loadBuiltinProfiles();
    return profiles.filter(p => p.category === category);
  }

  /**
   * Get a single profile by ID.
   */
  static getProfileById(id: string): AutopilotProfile | null {
    const profiles = this.loadBuiltinProfiles();
    return profiles.find(p => p.id === id) || null;
  }

  /**
   * Get all available categories.
   */
  static getCategories(): string[] {
    const profiles = this.loadBuiltinProfiles();
    const categories = new Set(profiles.map(p => p.category));
    return Array.from(categories).sort();
  }

  /**
   * Reset the loader (useful for testing).
   */
  static reset(): void {
    this.profiles = [];
    this.loaded = false;
  }
}
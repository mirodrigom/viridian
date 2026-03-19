import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Users ──
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.text('username').unique().notNullable();
    t.text('password_hash').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── Sessions ──
  await knex.schema.createTable('sessions', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('claude_session_id');
    t.text('provider').defaultTo('claude');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Settings ──
  await knex.schema.createTable('settings', (t) => {
    t.text('key').primary();
    t.text('value').notNullable();
  });

  // ── API keys ──
  await knex.schema.createTable('api_keys', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('key_prefix').notNullable();
    t.text('key_hash').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('last_used_at');
    t.integer('revoked').defaultTo(0);
    t.index('user_id');
    t.index('key_hash');
  });

  // ── Tasks ──
  await knex.schema.createTable('tasks', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('title').notNullable();
    t.text('description').defaultTo('');
    t.text('details').defaultTo('');
    t.text('status').defaultTo('todo');
    t.text('priority').defaultTo('medium');
    t.text('parent_id').references('id').inTable('tasks').onDelete('CASCADE');
    t.text('dependency_ids').defaultTo('[]');
    t.text('prd_source');
    t.integer('sort_order').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'project_path']);
  });

  // ── Graphs ──
  await knex.schema.createTable('graphs', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('name').notNullable().defaultTo('Untitled Graph');
    t.text('description').defaultTo('');
    t.text('graph_data').notNullable().defaultTo('{}');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'project_path']);
  });

  // ── Diagrams ──
  await knex.schema.createTable('diagrams', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('name').notNullable().defaultTo('Untitled Diagram');
    t.text('description').defaultTo('');
    t.text('diagram_data').notNullable().defaultTo('{}');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'project_path']);
  });

  // ── Graph runs ──
  await knex.schema.createTable('graph_runs', (t) => {
    t.text('id').primary();
    t.text('graph_id').references('id').inTable('graphs').onDelete('SET NULL');
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('prompt').notNullable();
    t.text('status').defaultTo('running');
    t.text('final_output');
    t.text('error');
    t.text('timeline').defaultTo('[]');
    t.text('executions').defaultTo('{}');
    t.integer('total_input_tokens').defaultTo(0);
    t.integer('total_output_tokens').defaultTo(0);
    t.text('provider').defaultTo('claude');
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at');
    t.index('graph_id');
    t.index(['user_id', 'project_path']);
  });

  // ── Session cache ──
  await knex.schema.createTable('session_cache', (t) => {
    t.text('id').notNullable();
    t.text('project_dir').notNullable();
    t.text('title').notNullable();
    t.text('project_path').defaultTo('');
    t.integer('message_count').defaultTo(0);
    t.bigInteger('last_active').notNullable();
    t.bigInteger('file_mtime').notNullable();
    t.text('provider').defaultTo('claude');
    t.integer('is_internal').defaultTo(0);
    t.text('preferences').defaultTo('{}');
    t.primary(['project_dir', 'id']);
    t.index('last_active');
  });

  // ── Management services ──
  await knex.schema.createTable('management_services', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('command').notNullable();
    t.text('cwd').defaultTo('');
    t.integer('sort_order').defaultTo(0);
    t.text('project_path').defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Management scripts ──
  await knex.schema.createTable('management_scripts', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('command').notNullable();
    t.text('cwd').defaultTo('');
    t.integer('sort_order').defaultTo(0);
    t.text('project_path').defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Autopilot profiles ──
  await knex.schema.createTable('autopilot_profiles', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('role').notNullable();
    t.text('description').defaultTo('');
    t.text('system_prompt').notNullable();
    t.text('allowed_tools').defaultTo('[]');
    t.text('disallowed_tools').defaultTo('[]');
    t.text('model');
    t.integer('is_builtin').defaultTo(0);
    t.text('category').defaultTo('general');
    t.text('tags').defaultTo('[]');
    t.text('subagents').defaultTo('[]');
    t.text('mcp_servers').defaultTo('[]');
    t.text('append_system_prompt');
    t.integer('max_turns');
    t.text('permission_mode');
    t.text('icon');
    t.text('difficulty');
    t.text('provider').defaultTo('claude');
    t.text('domain').defaultTo('general');
    t.text('routing_from').defaultTo('[]');
    t.text('routing_to').defaultTo('[]');
    t.text('capabilities').defaultTo('[]');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Autopilot configs ──
  await knex.schema.createTable('autopilot_configs', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('name').notNullable().defaultTo('Autopilot Session');
    t.text('agent_a_profile').notNullable();
    t.text('agent_b_profile').notNullable();
    t.text('allowed_paths').defaultTo('[]');
    t.text('agent_a_model').defaultTo('claude-sonnet-4-6');
    t.text('agent_b_model').defaultTo('claude-sonnet-4-6');
    t.integer('max_iterations').defaultTo(50);
    t.integer('max_tokens_per_session').defaultTo(500000);
    t.integer('schedule_enabled').defaultTo(0);
    t.text('schedule_start_time');
    t.text('schedule_end_time');
    t.text('schedule_days').defaultTo('[1,2,3,4,5]');
    t.text('schedule_timezone').defaultTo('UTC');
    t.text('goal_prompt').notNullable().defaultTo('');
    t.integer('run_test_verification').defaultTo(1);
    t.text('agent_a_provider').defaultTo('claude');
    t.text('agent_b_provider').defaultTo('claude');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Autopilot runs ──
  await knex.schema.createTable('autopilot_runs', (t) => {
    t.text('id').primary();
    t.text('config_id').references('id').inTable('autopilot_configs').onDelete('CASCADE');
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('status').defaultTo('pending');
    t.text('branch_name');
    t.integer('commit_count').defaultTo(0);
    t.integer('cycle_count').defaultTo(0);
    t.integer('agent_a_input_tokens').defaultTo(0);
    t.integer('agent_a_output_tokens').defaultTo(0);
    t.integer('agent_b_input_tokens').defaultTo(0);
    t.integer('agent_b_output_tokens').defaultTo(0);
    t.text('agent_a_claude_session_id');
    t.text('agent_a_profile_id');
    t.text('agent_b_profile_id');
    t.text('goal_prompt').defaultTo('');
    t.text('agent_b_claude_session_id');
    t.timestamp('rate_limited_until');
    t.text('agent_a_provider').defaultTo('claude');
    t.text('agent_b_provider').defaultTo('claude');
    t.text('agent_a_provider_session_id');
    t.text('agent_b_provider_session_id');
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('paused_at');
    t.timestamp('completed_at');
    t.text('error');
    t.index('config_id');
    t.index('status');
  });

  // ── Autopilot cycles ──
  await knex.schema.createTable('autopilot_cycles', (t) => {
    t.text('id').primary();
    t.text('run_id').references('id').inTable('autopilot_runs').onDelete('CASCADE');
    t.integer('cycle_number').notNullable();
    t.text('agent_a_prompt');
    t.text('agent_a_response');
    t.integer('agent_a_tokens_in').defaultTo(0);
    t.integer('agent_a_tokens_out').defaultTo(0);
    t.text('agent_b_prompt');
    t.text('agent_b_response');
    t.integer('agent_b_tokens_in').defaultTo(0);
    t.integer('agent_b_tokens_out').defaultTo(0);
    t.text('commit_hash');
    t.text('commit_message');
    t.text('files_changed').defaultTo('[]');
    t.text('status').defaultTo('pending');
    t.integer('is_test_verification').defaultTo(0);
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at');
    t.index(['run_id', 'cycle_number']);
  });

  // ── Manuals ──
  await knex.schema.createTable('manuals', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('title').notNullable().defaultTo('Untitled Manual');
    t.text('prompt').notNullable().defaultTo('');
    t.text('content').notNullable().defaultTo('');
    t.text('logo1_data').defaultTo('');
    t.text('logo2_data').defaultTo('');
    t.text('logo1_position').defaultTo('{"x":50,"y":30,"width":120,"height":60}');
    t.text('logo2_position').defaultTo('{"x":530,"y":30,"width":120,"height":60}');
    t.text('status').defaultTo('draft');
    t.text('brand_colors').defaultTo('[]');
    t.text('pdf_data').defaultTo('');
    t.text('mode').defaultTo('generate');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'project_path']);
  });

  // ── Manual versions ──
  await knex.schema.createTable('manual_versions', (t) => {
    t.text('id').primary();
    t.text('manual_id').notNullable().references('id').inTable('manuals').onDelete('CASCADE');
    t.text('content').notNullable().defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['manual_id', 'created_at']);
  });

  // ── MCP servers ──
  await knex.schema.createTable('mcp_servers', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('server_type').notNullable().defaultTo('stdio');
    t.text('command').defaultTo('');
    t.text('args').defaultTo('[]');
    t.text('env').defaultTo('{}');
    t.text('url').defaultTo('');
    t.text('headers').defaultTo('{}');
    t.integer('enabled').defaultTo(1);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Projects ──
  await knex.schema.createTable('projects', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('path').notNullable();
    t.text('description').defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Project services ──
  await knex.schema.createTable('project_services', (t) => {
    t.text('id').primary();
    t.text('project_id').references('id').inTable('projects').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('command').notNullable();
    t.integer('sort_order').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('project_id');
  });

  // ── Scheduled tasks ──
  await knex.schema.createTable('scheduled_tasks', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.text('description').defaultTo('');
    t.text('prompt').notNullable();
    t.text('schedule').notNullable();
    t.text('project_dir').notNullable();
    t.integer('enabled').defaultTo(1);
    t.timestamp('last_run_at');
    t.timestamp('next_run_at');
    t.text('status').defaultTo('idle');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── Scheduled task executions ──
  await knex.schema.createTable('scheduled_task_executions', (t) => {
    t.text('id').primary();
    t.text('task_id').notNullable().references('id').inTable('scheduled_tasks').onDelete('CASCADE');
    t.text('status').defaultTo('running');
    t.text('output').defaultTo('');
    t.text('error');
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at');
    t.integer('duration_ms');
    t.index(['task_id', 'started_at']);
  });

  // ── Traces ──
  await knex.schema.createTable('traces', (t) => {
    t.text('id').primary();
    t.text('name').notNullable().defaultTo('chat');
    t.text('user_id');
    t.text('session_id');
    t.text('metadata').defaultTo('{}');
    t.text('tags').defaultTo('[]');
    t.text('input');
    t.text('output');
    t.text('status').defaultTo('active');
    t.text('start_time');
    t.text('end_time');
    t.integer('input_tokens').defaultTo(0);
    t.integer('output_tokens').defaultTo(0);
    t.index('user_id');
    t.index('start_time');
  });

  // ── Observations ──
  await knex.schema.createTable('observations', (t) => {
    t.text('id').primary();
    t.text('trace_id').notNullable().references('id').inTable('traces').onDelete('CASCADE');
    t.text('parent_observation_id');
    t.text('type').notNullable().defaultTo('SPAN');
    t.text('name').notNullable();
    t.text('input');
    t.text('output');
    t.text('model');
    t.text('metadata').defaultTo('{}');
    t.text('start_time');
    t.text('end_time');
    t.integer('input_tokens').defaultTo(0);
    t.integer('output_tokens').defaultTo(0);
    t.text('level').defaultTo('DEFAULT');
    t.text('status_message');
    t.index('trace_id');
    t.index('parent_observation_id');
  });

  // ── Personas ──
  await knex.schema.createTable('personas', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('description').defaultTo('');
    t.text('icon').defaultTo('Bot');
    t.text('color').defaultTo('#6366f1');
    t.text('system_prompt').notNullable().defaultTo('');
    t.text('suggested_tools').defaultTo('[]');
    t.integer('is_builtin').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ── Provider config ──
  await knex.schema.createTable('provider_config', (t) => {
    t.text('provider_id').primary();
    t.text('env_vars').notNullable().defaultTo('{}');
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'observations', 'traces', 'scheduled_task_executions', 'scheduled_tasks',
    'project_services', 'projects', 'mcp_servers', 'manual_versions', 'manuals',
    'autopilot_cycles', 'autopilot_runs', 'autopilot_configs', 'autopilot_profiles',
    'management_scripts', 'management_services', 'session_cache', 'graph_runs',
    'diagrams', 'graphs', 'tasks', 'api_keys', 'settings', 'sessions',
    'personas', 'provider_config', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('confluence_pages', (t) => {
    t.text('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.text('project_path').notNullable();
    t.text('title').notNullable().defaultTo('Untitled Conversion');
    t.text('input_text').defaultTo('');
    t.text('markdown').defaultTo('');
    t.text('confluence_output').defaultTo('');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'project_path']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('confluence_pages');
}

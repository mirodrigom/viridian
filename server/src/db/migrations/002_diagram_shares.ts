import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('diagram_shares', (t) => {
    t.text('id').primary(); // UUID — the share token used in the URL
    t.text('diagram_id').notNullable().references('id').inTable('diagrams').onDelete('CASCADE');
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['diagram_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('diagram_shares');
}

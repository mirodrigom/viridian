# Plan: Documentación sincronizada con versión en cada push

## Resumen

Establecer un flujo donde antes de cada push a main, yo (Claude) actualice manualmente la documentación según los archivos cambiados, sugiera el tipo de bump semver, y haga el commit con todo sincronizado.

## Lo que NO se automatiza

No se crean scripts ni hooks. Todo el proceso lo manejo yo revisando los cambios antes de cada push.

## Qué se necesita crear/modificar

### 1. Agregar página de Changelog (`docs/guide/changelog.md`)

Crear una página de changelog que registre cada versión con:
- Número de versión y fecha
- Lista de cambios organizados por categoría (Added, Changed, Fixed, Removed)
- Formato [Keep a Changelog](https://keepachangelog.com/)
- Backfill de la versión actual (0.1.0) con un resumen de lo que existe

### 2. Registrar el changelog en la sidebar de VitePress

Agregar entrada en `docs/.vitepress/config.ts` en la sección Guide del sidebar.

### 3. Agregar badge de versión en `docs/index.md`

Mostrar la versión actual en la landing page de docs para que sea visible.

### 4. Documentar el flujo en mi memoria

Agregar instrucciones en MEMORY.md para que en cada sesión sepa que antes de un push debo:

1. Revisar `git diff main` para ver todos los archivos cambiados
2. Identificar qué secciones de docs necesitan actualización según el mapeo:
   - `client/src/components/chat/` → `docs/guide/chat.md`
   - `client/src/components/editor/` → `docs/guide/editor.md`
   - `client/src/components/git/` → `docs/guide/git.md`
   - `client/src/components/terminal/` → `docs/guide/terminal.md`
   - `client/src/components/tasks/` → `docs/guide/tasks.md`
   - `client/src/components/autopilot/` → `docs/guide/autopilot.md`
   - `client/src/components/graphs/` → `docs/guide/graphs.md`
   - `server/src/routes/` → `docs/reference/api-endpoints.md` (auto-generate)
   - `server/src/ws/` → `docs/reference/websocket-events.md` (auto-generate)
   - `client/src/types/` → `docs/reference/typescript-types.md` (auto-generate)
   - `server/src/services/` → `docs/architecture/overview.md`
   - Nuevas features → `docs/guide/features.md`
3. Actualizar los .md correspondientes
4. Correr `pnpm docs:generate` para regenerar las API docs
5. Sugerir bump semver:
   - **patch**: bug fixes, tweaks menores, refactors internos
   - **minor**: nueva funcionalidad, mejoras visibles al usuario
   - **major**: breaking changes, reestructuración mayor
6. Bumpar versión en `package.json` (root, server, client, docs)
7. Actualizar `docs/guide/changelog.md` con los cambios de esta versión
8. Commit todo junto y push

## Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `docs/guide/changelog.md` | **Crear** - Página de changelog |
| `docs/.vitepress/config.ts` | **Editar** - Agregar changelog al sidebar |
| `docs/index.md` | **Editar** - Agregar badge de versión |
| `MEMORY.md` | **Editar** - Agregar sección de flujo de release |

## Scope

Minimal — solo crear la infraestructura (changelog + sidebar + badge + instrucciones). No se tocan scripts, hooks, ni CI. El proceso es 100% manual por mí en cada sesión.

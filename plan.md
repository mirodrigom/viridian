# Plan: Sitio de Documentacion con VitePress

## Resumen

Crear un sitio de documentacion VitePress como nuevo workspace `docs/` en el monorepo. La documentacion sera **hibrida**: contenido escrito manualmente en Markdown + secciones auto-generadas (API endpoints, tipos TypeScript, eventos WebSocket) mediante un script que parsea el codigo fuente.

---

## Estructura del workspace `docs/`

```
docs/
├── package.json                    # Workspace con vitepress como dep
├── .vitepress/
│   ├── config.ts                   # Configuracion VitePress (navbar, sidebar, theme)
│   └── theme/
│       └── index.ts                # Theme customizations (opcional)
├── scripts/
│   └── generate-api-docs.ts        # Script que parsea server/src/routes/ y genera .md
├── index.md                        # Landing page
├── guide/
│   ├── getting-started.md          # Instalacion, configuracion, primer uso
│   ├── chat.md                     # Chat: features, thinking modes, tools, voice
│   ├── editor.md                   # Editor de codigo, diff view, tabs
│   ├── git.md                      # Git integration: stage, commit, branches, AI messages
│   ├── terminal.md                 # Terminal PTY
│   ├── tasks.md                    # Task board, PRD parsing
│   ├── autopilot.md                # Autopilot: profiles, scheduling, dual-agent loop
│   ├── graphs.md                   # Graph runner: nodes, edges, templates, execution
│   └── settings.md                 # Settings, MCP, API keys, permissions
├── architecture/
│   ├── overview.md                 # Arquitectura general (client/server/ws/db)
│   ├── session-management.md       # Session IDs, --resume, JSONL
│   ├── websocket-protocol.md       # Protocolo WS: chat, autopilot, graph-runner
│   └── design-decisions.md         # Por que se tomo cada decision arquitectural
└── reference/
    ├── api-endpoints.md            # AUTO-GENERADO: todos los REST endpoints
    ├── websocket-events.md         # AUTO-GENERADO: todos los eventos WS
    └── typescript-types.md         # AUTO-GENERADO: interfaces principales
```

---

## Pasos de implementacion

### Paso 1: Scaffold del workspace
- Crear `docs/` con `package.json` (dep: `vitepress`)
- Agregar `"docs"` a `pnpm-workspace.yaml`
- Agregar scripts al root `package.json`: `dev:docs`, `build:docs`
- Crear `.vitepress/config.ts` con navbar (Guide, Architecture, Reference) y sidebar

### Paso 2: Landing page + Getting Started
- `index.md` — Hero con descripcion del proyecto, features destacados, quick links
- `guide/getting-started.md` — Requisitos, instalacion, configuracion `.env`, primer uso

### Paso 3: Guias de usuario (guide/)
- Una pagina por feature principal: chat, editor, git, terminal, tasks, autopilot, graphs, settings
- Cada pagina explica: que hace, por que funciona asi, como usarlo, screenshots/diagramas opcionales

### Paso 4: Documentacion tecnica (architecture/)
- `overview.md` — Stack, monorepo structure, flujo de datos
- `session-management.md` — Doble session ID, --resume, JSONL files
- `websocket-protocol.md` — 3 endpoints WS, message types, flujo de conexion
- `design-decisions.md` — Justificacion de decisiones clave

### Paso 5: Script de auto-generacion (scripts/generate-api-docs.ts)
- Parsear `server/src/routes/*.ts` para extraer endpoints (regex sobre `router.get/post/put/delete`)
- Parsear `client/src/types/*.ts` para extraer interfaces exportadas
- Parsear `server/src/ws/*.ts` para extraer message types
- Generar 3 archivos .md en `reference/`:
  - `api-endpoints.md` — Tabla con method, path, descripcion, auth requerido
  - `websocket-events.md` — Catalogo de eventos por endpoint
  - `typescript-types.md` — Interfaces principales con sus campos
- Agregar script `generate` al `package.json` de docs

### Paso 6: Integracion final
- Script npm `docs:generate` que corre el generador antes del build
- Verificar que `pnpm --filter docs build` funciona
- Agregar instrucciones de como actualizar la documentacion

---

## Decisiones tecnicas

| Decision | Eleccion | Razon |
|----------|----------|-------|
| Framework docs | VitePress | Nativo Vue, Markdown-first, rapido, buen DX |
| Auto-generacion | Script TS custom | Ligero, sin deps extra, parseamos patterns existentes |
| Formato reference | Markdown generado | Se commitea al repo, se puede revisar en PR |
| Idioma docs | Ingles | Proyecto open-source, i18n de VitePress disponible si se necesita |

---

## Que NO se incluye en este plan
- Deploy automatico (Netlify/Vercel) — se puede agregar despues
- i18n de la documentacion — solo ingles por ahora
- Generacion de OpenAPI/Swagger — el script custom es mas simple para este caso
- Tests para la documentacion

import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Viridian',
  description: 'Documentation for Viridian — a full-featured web UI for Claude Code',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Viridian',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API Reference', link: '/reference/api-endpoints' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Features Overview', link: '/guide/features' },
            { text: 'Changelog', link: '/guide/changelog' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Chat', link: '/guide/chat' },
            { text: 'Code Editor', link: '/guide/editor' },
            { text: 'Git Integration', link: '/guide/git' },
            { text: 'Terminal', link: '/guide/terminal' },
            { text: 'Task Board', link: '/guide/tasks' },
            { text: 'Autopilot', link: '/guide/autopilot' },
            { text: 'Graph Runner', link: '/guide/graphs' },
            { text: 'Settings & Configuration', link: '/guide/settings' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Session Management', link: '/architecture/session-management' },
            { text: 'WebSocket Protocol', link: '/architecture/websocket-protocol' },
            { text: 'Design Decisions', link: '/architecture/design-decisions' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'REST Endpoints', link: '/reference/api-endpoints' },
            { text: 'WebSocket Events', link: '/reference/websocket-events' },
            { text: 'TypeScript Types', link: '/reference/typescript-types' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mirodrigom/claude-code-web' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/mirodrigom/claude-code-web/edit/main/docs/:path',
      text: 'Edit this page',
    },

    footer: {
      message: 'Built with VitePress',
    },
  },
})

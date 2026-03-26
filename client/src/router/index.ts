import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const ProjectPage = () => import('@/pages/ProjectPage.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/project',
      name: 'project',
      component: ProjectPage,
      meta: { tab: 'chat' },
    },
    {
      path: '/chat/:sessionId',
      name: 'chat-session',
      component: ProjectPage,
      meta: { tab: 'chat' },
    },
    {
      path: '/editor',
      name: 'editor',
      component: ProjectPage,
      meta: { tab: 'editor' },
    },
    {
      path: '/git',
      name: 'git',
      component: ProjectPage,
      meta: { tab: 'git' },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: ProjectPage,
      meta: { tab: 'tasks' },
    },
    {
      path: '/graph',
      name: 'graph',
      component: ProjectPage,
      meta: { tab: 'graph' },
    },
    {
      path: '/graph/:graphId',
      name: 'graph-open',
      component: ProjectPage,
      meta: { tab: 'graph' },
    },
    {
      path: '/autopilot',
      name: 'autopilot',
      component: ProjectPage,
      meta: { tab: 'autopilot' },
    },
    {
      path: '/autopilot/:runId',
      name: 'autopilot-run',
      component: ProjectPage,
      meta: { tab: 'autopilot' },
    },
    {
      path: '/autopilot/:runId/:cycleNumber',
      name: 'autopilot-cycle',
      component: ProjectPage,
      meta: { tab: 'autopilot' },
    },
    {
      path: '/management',
      name: 'management',
      component: ProjectPage,
      meta: { tab: 'management' },
    },
    {
      path: '/diagrams',
      name: 'diagrams',
      component: ProjectPage,
      meta: { tab: 'diagrams' },
    },
    {
      path: '/diagrams/:diagramId',
      name: 'diagram-open',
      component: ProjectPage,
      meta: { tab: 'diagrams' },
    },
    {
      path: '/manuals',
      name: 'manuals',
      component: ProjectPage,
      meta: { tab: 'manuals' },
    },
    {
      path: '/scheduler',
      name: 'scheduler',
      component: ProjectPage,
      meta: { tab: 'scheduler' },
    },
    {
      path: '/share/d/:shareToken',
      name: 'shared-diagram',
      component: () => import('@/pages/SharedDiagramPage.vue'),
      meta: { public: true },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard' };
  }
});

// Handle stale dynamic imports after Vite HMR / chunk hash changes
router.onError((error, to) => {
  if (
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Importing a module script failed')
  ) {
    window.location.href = to.fullPath;
  }
});

export default router;

import type { App } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Navigation Guard bảo vệ các trang yêu cầu đăng nhập
router.beforeEach((to, from, next) => {
  const publicPages = ['/login', '/register']
  const authRequired = !publicPages.includes(to.path)
  const token = localStorage.getItem('dvs_token') || sessionStorage.getItem('dvs_token')

  if (authRequired && !token) {
    return next('/login')
  }

  if (to.path === '/login' && token) {
    return next('/dashboard')
  }

  next()
})

export default function (app: App) {
  app.use(router)
}

export { router }

import type { Page } from "@playwright/test";

/**
 * 预热 dev 模式下的 auth 路由。
 *
 * Next dev 按路由懒编译：某个 route handler 第一次被请求时要现编译，
 * 编译窗口内浏览器 fetch 可能拿到 HTML 错误页（`<!DOCTYPE`），
 * 前端 JSON 解析就炸出 "Unexpected token '<'"。
 *
 * /api/auth/* 对 proxy 豁免，未登录也能真正到达 handler（GET 返回 405 即可
 * 触发模块编译），因此是最早可用的预热入口。预热失败不影响测试。
 */
export async function warmUpAuthRoutes(page: Page): Promise<void> {
  await Promise.all(
    ["/api/auth/register", "/api/auth/login", "/api/auth/me"].map((route) =>
      page.request.get(route).catch(() => undefined)
    )
  );
}

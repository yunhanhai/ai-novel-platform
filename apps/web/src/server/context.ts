// 上下文：MVP 阶段从环境变量读取；接入 session 后调用 getSessionContext() 覆盖
// 服务端唯一真相源 —— API 路由 + (app) layout 都通过它读取

const ORG_KEY = "DEFAULT_ORGANIZATION_ID";
const USER_KEY = "DEFAULT_USER_ID";

type EnvSource = Record<string, string | undefined>;

export function getOrganizationId(env: EnvSource = process.env): string {
  const value = env[ORG_KEY]?.trim();
  if (!value) {
    throw new Error(`${ORG_KEY} 未配置：请在环境变量中设置默认组织 ID`);
  }
  return value;
}

export function safeGetOrganizationId(env: EnvSource = process.env): string | null {
  const value = env[ORG_KEY]?.trim();
  return value || null;
}

// MVP 没有登录态：所有写入操作的 createdById/userId 用此函数；接入 auth 后改为 session.userId
export function getUserId(env: EnvSource = process.env): string {
  const value = env[USER_KEY]?.trim();
  if (!value) {
    throw new Error(`${USER_KEY} 未配置：请在环境变量中设置默认用户 ID`);
  }
  return value;
}

export function safeGetUserId(env: EnvSource = process.env): string | null {
  const value = env[USER_KEY]?.trim();
  return value || null;
}

/**
 * 本地开发 seed 脚本：确保最小可用集合存在
 *
 * 幂等：每条记录先按业务唯一键查存在，再决定 upsert / skip。
 *
 * 当前 seed 内容：
 *   - 1 个 ModelProvider（OpenAI Compatible，PLATFORM_KEY，加密 key 可选）
 *   - 1 个 ModelProfile（组织级、taskType="default"，触发 resolver 兜底）
 *   - 1 个 WritingMethodology（三幕剧，挂在 smoke 项目）
 *   - 1 个 StyleProfile（通俗易读，挂在 smoke 项目）
 *
 * 即使无 OPENAI_API_KEY / ENCRYPTION_KEY，所有 4 条记录都会创建（key 留空）；
 * 配合 USE_FAKE_MODEL=true，worker 会在解析失败时降级到 fake-model 跑通流程。
 */
import { prisma } from "../src/client";
import { encrypt } from "../../shared/src/crypto/encryption";

const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID;
const USER_ID = process.env.DEFAULT_USER_ID;

if (!ORG_ID || !USER_ID) {
  console.error("❌ DEFAULT_ORGANIZATION_ID 或 DEFAULT_USER_ID 未设置");
  process.exit(1);
}

function getEncryptionKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex.slice(0, 64), "hex");
}

async function encryptIfPossible(plaintext: string | null): Promise<string | null> {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  if (!key) {
    console.warn("⚠️  ENCRYPTION_KEY 未设置或长度不足 64 hex，API key 不写入");
    return null;
  }
  return encrypt(plaintext, key);
}

async function seedProvider() {
  const existing = await prisma.modelProvider.findFirst({
    where: { organizationId: ORG_ID!, name: "OpenAI 默认" }
  });
  if (existing) {
    console.log(`✓ ModelProvider 已存在: ${existing.id}`);
    return existing;
  }

  const encryptedApiKey = await encryptIfPossible(process.env.OPENAI_API_KEY ?? null);

  const provider = await prisma.modelProvider.create({
    data: {
      organizationId: ORG_ID!,
      ownerUserId: USER_ID!,
      name: "OpenAI 默认",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.openai.com/v1",
      encryptedApiKey,
      authMode: "PLATFORM_KEY",
      protocol: "CHAT_COMPLETIONS",
      isDefault: true,
      status: "ACTIVE"
    }
  });
  console.log(`✚ ModelProvider 已创建: ${provider.id} (key=${encryptedApiKey ? "已加密" : "空"})`);
  return provider;
}

async function seedProfile(providerId: string) {
  const existing = await prisma.modelProfile.findFirst({
    where: { organizationId: ORG_ID!, projectId: null, taskType: "default" }
  });
  if (existing) {
    console.log(`✓ ModelProfile 已存在: ${existing.id}`);
    return existing;
  }

  const profile = await prisma.modelProfile.create({
    data: {
      organizationId: ORG_ID!,
      projectId: null,
      providerId,
      name: "组织默认模型",
      modelName: "gpt-4o-mini",
      taskType: "default",
      temperature: 0.7,
      maxOutputTokens: 4096
    }
  });
  console.log(`✚ ModelProfile 已创建: ${profile.id} (model=gpt-4o-mini, taskType=default)`);
  return profile;
}

async function seedMethodology(projectId: string) {
  const existing = await prisma.writingMethodology.findFirst({
    where: { projectId, name: "三幕剧 · 默认" }
  });
  if (existing) {
    console.log(`✓ WritingMethodology 已存在: ${existing.id}`);
    return existing;
  }

  const methodology = await prisma.writingMethodology.create({
    data: {
      organizationId: ORG_ID!,
      projectId,
      name: "三幕剧 · 默认",
      methodType: "three_act",
      description: "经典三幕剧结构：建置 → 对抗 → 结局。",
      outlineMetadata: {
        acts: [
          { name: "第一幕 · 建置", percentage: 25, focus: "人物登场、世界建立、激励事件" },
          { name: "第二幕 · 对抗", percentage: 50, focus: "冲突升级、人物弧光、中点反转" },
          { name: "第三幕 · 结局", percentage: 25, focus: "高潮、决断、收束" }
        ]
      },
      reviewCriteria: {
        checks: [
          "激励事件是否在第一幕末出现",
          "中点是否有有效反转",
          "主角弧光是否完成",
          "次要伏笔是否回收"
        ]
      },
      isActive: true
    }
  });
  console.log(`✚ WritingMethodology 已创建: ${methodology.id} (三幕剧)`);
  return methodology;
}

async function seedStyleProfile(projectId: string) {
  const existing = await prisma.styleProfile.findFirst({
    where: { projectId, name: "通俗易读 · 默认" }
  });
  if (existing) {
    console.log(`✓ StyleProfile 已存在: ${existing.id}`);
    return existing;
  }

  const style = await prisma.styleProfile.create({
    data: {
      organizationId: ORG_ID!,
      projectId,
      name: "通俗易读 · 默认",
      styleBrief: "节奏明快，对白与描写均衡，避免长难句和华丽辞藻。",
      sentenceLengthProfile: { avg: 18, min: 6, max: 35 },
      dialogueRatio: 0.35,
      descriptionDensity: 0.45,
      bannedWords: ["仿佛", "霎时间", "瞬息之间"],
      preferredWords: ["他想", "她说", "于是"],
      rhythmNotes: "每 3-4 段对白后插入一次环境/心理描写。",
      isActive: true
    }
  });
  console.log(`✚ StyleProfile 已创建: ${style.id} (通俗易读)`);
  return style;
}

async function main() {
  console.log(`🌱 seed 开始（org=${ORG_ID}, user=${USER_ID}）`);

  const provider = await seedProvider();
  await seedProfile(provider.id);

  // 找到组织下任意一个项目（演示用），如果没有则跳过项目级 seed
  const project = await prisma.project.findFirst({
    where: { organizationId: ORG_ID! },
    orderBy: { createdAt: "asc" }
  });

  if (!project) {
    console.log("ℹ️  组织下无项目，跳过 WritingMethodology / StyleProfile seed");
  } else {
    console.log(`📁 项目: ${project.id} "${project.title}"`);
    await seedMethodology(project.id);
    await seedStyleProfile(project.id);
  }

  console.log("✅ seed 完成");
}

main()
  .catch((error) => {
    console.error("❌ seed 失败:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

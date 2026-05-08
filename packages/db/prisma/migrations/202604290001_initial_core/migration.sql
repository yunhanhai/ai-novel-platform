-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'disabled', 'deleted');

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "billing_mode" AS ENUM ('byok', 'platform', 'hybrid');

-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('active', 'invited', 'removed');

-- CreateEnum
CREATE TYPE "project_type" AS ENUM ('long_novel', 'short_story');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('draft', 'active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "project_role" AS ENUM ('project_owner', 'editor', 'commenter', 'viewer');

-- CreateEnum
CREATE TYPE "outline_level" AS ENUM ('book', 'volume', 'chapter', 'beat');

-- CreateEnum
CREATE TYPE "outline_status" AS ENUM ('planned', 'drafting', 'done');

-- CreateEnum
CREATE TYPE "volume_status" AS ENUM ('planned', 'drafting', 'finished');

-- CreateEnum
CREATE TYPE "chapter_status" AS ENUM ('planned', 'draft', 'reviewing', 'final');

-- CreateEnum
CREATE TYPE "content_format" AS ENUM ('markdown', 'plain');

-- CreateEnum
CREATE TYPE "content_entity_type" AS ENUM ('chapter', 'outline', 'character', 'world_item');

-- CreateEnum
CREATE TYPE "content_version_source" AS ENUM ('manual', 'ai', 'import');

-- CreateEnum
CREATE TYPE "provider_type" AS ENUM ('openai_compatible', 'anthropic', 'gemini', 'deepseek', 'custom');

-- CreateEnum
CREATE TYPE "auth_mode" AS ENUM ('user_key', 'platform_key');

-- CreateEnum
CREATE TYPE "model_protocol" AS ENUM ('chat_completions', 'responses', 'messages', 'auto');

-- CreateEnum
CREATE TYPE "provider_status" AS ENUM ('active', 'disabled', 'error');

-- CreateEnum
CREATE TYPE "generation_job_type" AS ENUM ('generate_outline', 'generate_chapter', 'continue_chapter', 'rewrite', 'polish', 'deslop', 'review', 'extract_memory');

-- CreateEnum
CREATE TYPE "generation_target_entity_type" AS ENUM ('project', 'outline', 'chapter');

-- CreateEnum
CREATE TYPE "generation_job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "generation_step_status" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "billing_source" AS ENUM ('user_key', 'platform');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "locale" VARCHAR(20) NOT NULL DEFAULT 'zh-CN',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_user_id" VARCHAR(160) NOT NULL,
    "provider_email" VARCHAR(320),
    "raw_profile" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "plan_code" VARCHAR(40) NOT NULL DEFAULT 'free',
    "billing_mode" "billing_mode" NOT NULL DEFAULT 'hybrid',
    "owner_user_id" UUID NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'active',
    "settings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "status" "member_status" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "organization_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "type" "project_type" NOT NULL DEFAULT 'long_novel',
    "genre" VARCHAR(80),
    "target_audience" VARCHAR(120),
    "platform_target" VARCHAR(80),
    "style_brief" TEXT,
    "premise" TEXT,
    "selling_points" JSONB,
    "target_word_count" INTEGER,
    "update_cadence" VARCHAR(40),
    "status" "project_status" NOT NULL DEFAULT 'draft',
    "default_model_profile_id" UUID,
    "settings" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "project_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "level" "outline_level" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "order_index" INTEGER NOT NULL,
    "target_chapter_id" UUID,
    "status" "outline_status" NOT NULL DEFAULT 'planned',
    "metadata" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volumes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "summary" TEXT,
    "order_index" INTEGER NOT NULL,
    "target_word_count" INTEGER,
    "status" "volume_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "volumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "volume_id" UUID,
    "chapter_no" INTEGER NOT NULL,
    "volume_chapter_no" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "outline_summary" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "content_format" "content_format" NOT NULL DEFAULT 'markdown',
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "status" "chapter_status" NOT NULL DEFAULT 'planned',
    "last_generated_job_id" UUID,
    "locked_by_job_id" UUID,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_type" "content_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "title" VARCHAR(200),
    "content" TEXT NOT NULL,
    "diff" JSONB,
    "source" "content_version_source" NOT NULL,
    "generation_job_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_providers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "provider_type" "provider_type" NOT NULL,
    "base_url" TEXT,
    "encrypted_api_key" TEXT,
    "auth_mode" "auth_mode" NOT NULL,
    "protocol" "model_protocol" NOT NULL DEFAULT 'auto',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "provider_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "provider_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "model_name" VARCHAR(160) NOT NULL,
    "task_type" VARCHAR(60) NOT NULL,
    "temperature" DECIMAL(3,2),
    "top_p" DECIMAL(3,2),
    "max_output_tokens" INTEGER,
    "settings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "model_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "project_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "task_type" VARCHAR(60) NOT NULL,
    "template" TEXT NOT NULL,
    "variables_schema" JSONB,
    "version_no" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "model_profile_id" UUID,
    "job_type" "generation_job_type" NOT NULL,
    "target_entity_type" "generation_target_entity_type",
    "target_entity_id" UUID,
    "status" "generation_job_status" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error_code" VARCHAR(80),
    "error_message" TEXT,
    "progress" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lock_key" VARCHAR(160),
    "lease_expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "step_key" VARCHAR(80) NOT NULL,
    "status" "generation_step_status" NOT NULL DEFAULT 'pending',
    "model_profile_id" UUID,
    "prompt_snapshot" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "output_preview" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "generation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "project_id" UUID,
    "generation_job_id" UUID,
    "provider_id" UUID,
    "model_name" VARCHAR(160) NOT NULL,
    "billing_source" "billing_source" NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_cents" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_user_identities_user" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_user_id_key" ON "user_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "idx_organizations_owner" ON "organizations"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_org_members_user" ON "organization_members"("user_id");

-- CreateIndex
CREATE INDEX "idx_org_members_org_role" ON "organization_members"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_invitations_org_email" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "idx_projects_org_status" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_projects_updated" ON "projects"("organization_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_slug_key" ON "projects"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "idx_project_members_org_project" ON "project_members"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_project_members_user" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_outlines_org_project" ON "outlines"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_outlines_project_parent" ON "outlines"("project_id", "parent_id", "order_index");

-- CreateIndex
CREATE INDEX "idx_outlines_target_chapter" ON "outlines"("target_chapter_id");

-- CreateIndex
CREATE INDEX "idx_volumes_org_project" ON "volumes"("organization_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "volumes_project_id_order_index_key" ON "volumes"("project_id", "order_index");

-- CreateIndex
CREATE INDEX "idx_chapters_org_project" ON "chapters"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_chapters_project_volume" ON "chapters"("project_id", "volume_id", "chapter_no");

-- CreateIndex
CREATE INDEX "idx_chapters_status" ON "chapters"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_project_id_chapter_no_key" ON "chapters"("project_id", "chapter_no");

-- CreateIndex
CREATE INDEX "idx_content_versions_org_project" ON "content_versions"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "idx_content_versions_entity" ON "content_versions"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_entity_type_entity_id_version_no_key" ON "content_versions"("entity_type", "entity_id", "version_no");

-- CreateIndex
CREATE INDEX "idx_model_providers_org" ON "model_providers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_model_profiles_task" ON "model_profiles"("organization_id", "project_id", "task_type");

-- CreateIndex
CREATE INDEX "idx_prompt_templates_lookup" ON "prompt_templates"("organization_id", "project_id", "task_type", "is_active");

-- CreateIndex
CREATE INDEX "idx_generation_jobs_project_status" ON "generation_jobs"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_generation_jobs_org_created" ON "generation_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_generation_jobs_lock" ON "generation_jobs"("lock_key", "lease_expires_at");

-- CreateIndex
CREATE INDEX "idx_generation_steps_job" ON "generation_steps"("job_id");

-- CreateIndex
CREATE INDEX "idx_generation_steps_org_job" ON "generation_steps"("organization_id", "job_id");

-- CreateIndex
CREATE INDEX "idx_usage_org_time" ON "usage_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_usage_project_time" ON "usage_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_audit_org_time" ON "audit_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "outlines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_target_chapter_id_fkey" FOREIGN KEY ("target_chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlines" ADD CONSTRAINT "outlines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_volume_id_fkey" FOREIGN KEY ("volume_id") REFERENCES "volumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_providers" ADD CONSTRAINT "model_providers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_providers" ADD CONSTRAINT "model_providers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_model_profile_id_fkey" FOREIGN KEY ("model_profile_id") REFERENCES "model_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_steps" ADD CONSTRAINT "generation_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_steps" ADD CONSTRAINT "generation_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_steps" ADD CONSTRAINT "generation_steps_model_profile_id_fkey" FOREIGN KEY ("model_profile_id") REFERENCES "model_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

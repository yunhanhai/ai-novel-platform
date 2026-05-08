-- Phase B: 写作资产真源

-- B1. characters
CREATE TABLE "characters" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "aliases" JSONB,
    "role_type" VARCHAR(40) NOT NULL,
    "appearance" TEXT,
    "personality" TEXT,
    "motivation" TEXT,
    "speech_pattern" TEXT,
    "knowledge_boundary" JSONB,
    "arc" TEXT,
    "constraints" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "characters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "characters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "characters_project_id_name_key" ON "characters"("project_id", "name");
CREATE INDEX "idx_characters_org_project_status" ON "characters"("organization_id", "project_id", "status");
CREATE INDEX "idx_characters_project_role" ON "characters"("project_id", "role_type");

-- B2. character_relationships
CREATE TABLE "character_relationships" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_character_id" UUID NOT NULL,
    "target_character_id" UUID NOT NULL,
    "relation_type" VARCHAR(60) NOT NULL,
    "strength" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "changed_at_chapter_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_relationships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "character_relationships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "character_relationships_source_fkey" FOREIGN KEY ("source_character_id") REFERENCES "characters"("id") ON DELETE CASCADE,
    CONSTRAINT "character_relationships_target_fkey" FOREIGN KEY ("target_character_id") REFERENCES "characters"("id") ON DELETE CASCADE,
    CONSTRAINT "character_relationships_chapter_fkey" FOREIGN KEY ("changed_at_chapter_id") REFERENCES "chapters"("id")
);

CREATE UNIQUE INDEX "character_relationships_unique" ON "character_relationships"("project_id", "source_character_id", "target_character_id", "relation_type");
CREATE INDEX "idx_character_relationships_org_project" ON "character_relationships"("organization_id", "project_id", "status");
CREATE INDEX "idx_character_relationships_source" ON "character_relationships"("source_character_id");
CREATE INDEX "idx_character_relationships_target" ON "character_relationships"("target_character_id");

-- B3. world_items
CREATE TABLE "world_items" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "item_type" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "aliases" JSONB,
    "summary" TEXT,
    "detail" TEXT,
    "constraints" TEXT,
    "activation_keywords" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "world_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "world_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "world_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "world_items_project_id_item_type_name_key" ON "world_items"("project_id", "item_type", "name");
CREATE INDEX "idx_world_items_org_project_type" ON "world_items"("organization_id", "project_id", "item_type");
CREATE INDEX "idx_world_items_project_priority" ON "world_items"("project_id", "priority");

-- B4. plot_threads
CREATE TABLE "plot_threads" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "thread_type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'planted',
    "planted_chapter_id" UUID,
    "expected_payoff_chapter_id" UUID,
    "resolved_chapter_id" UUID,
    "cooldown_until_chapter_no" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dependencies" JSONB,
    "evidence" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "plot_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "plot_threads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "plot_threads_planted_chapter_fkey" FOREIGN KEY ("planted_chapter_id") REFERENCES "chapters"("id"),
    CONSTRAINT "plot_threads_expected_payoff_chapter_fkey" FOREIGN KEY ("expected_payoff_chapter_id") REFERENCES "chapters"("id"),
    CONSTRAINT "plot_threads_resolved_chapter_fkey" FOREIGN KEY ("resolved_chapter_id") REFERENCES "chapters"("id"),
    CONSTRAINT "plot_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id")
);

CREATE INDEX "idx_plot_threads_org_project_status" ON "plot_threads"("organization_id", "project_id", "status", "priority");
CREATE INDEX "idx_plot_threads_expected_payoff" ON "plot_threads"("project_id", "expected_payoff_chapter_id");
CREATE INDEX "idx_plot_threads_project_status" ON "plot_threads"("project_id", "status");

-- B5. project_memories
CREATE TABLE "project_memories" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "memory_type" VARCHAR(40) NOT NULL,
    "scope_type" VARCHAR(40) NOT NULL,
    "scope_id" UUID,
    "content" TEXT NOT NULL,
    "content_json" JSONB,
    "source_chapter_id" UUID,
    "source_job_id" UUID,
    "confidence" INTEGER DEFAULT 100,
    "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_memories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "project_memories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "project_memories_source_chapter_fkey" FOREIGN KEY ("source_chapter_id") REFERENCES "chapters"("id"),
    CONSTRAINT "project_memories_source_job_fkey" FOREIGN KEY ("source_job_id") REFERENCES "generation_jobs"("id")
);

CREATE INDEX "idx_project_memories_lookup" ON "project_memories"("organization_id", "project_id", "memory_type", "scope_type", "scope_id");
CREATE INDEX "idx_project_memories_project_status" ON "project_memories"("project_id", "status", "created_at");
CREATE INDEX "idx_project_memories_type" ON "project_memories"("project_id", "memory_type");

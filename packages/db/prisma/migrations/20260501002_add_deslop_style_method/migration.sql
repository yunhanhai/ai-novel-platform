-- Phase E: 去AI味规则
CREATE TABLE "deslop_rules" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rule_type" VARCHAR(40) NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'warning',
    "suggestion" TEXT,
    "genre" VARCHAR(60),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deslop_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "deslop_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);
CREATE INDEX "idx_deslop_rules_lookup" ON "deslop_rules"("organization_id", "project_id", "is_active");
CREATE INDEX "idx_deslop_rules_category" ON "deslop_rules"("project_id", "category");

-- Phase F: 风格画像
CREATE TABLE "style_profiles" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "reference_texts" JSONB,
    "style_brief" TEXT,
    "sentence_length_profile" JSONB,
    "dialogue_ratio" DECIMAL(5,2),
    "description_density" DECIMAL(5,2),
    "banned_words" JSONB,
    "preferred_words" JSONB,
    "rhythm_notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "style_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "style_profiles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "style_profiles_project_id_name_key" ON "style_profiles"("project_id", "name");
CREATE INDEX "idx_style_profiles_lookup" ON "style_profiles"("organization_id", "project_id", "is_active");

-- Phase F: 写作方法论
CREATE TABLE "writing_methodologies" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "method_type" VARCHAR(60) NOT NULL,
    "description" TEXT,
    "outline_metadata" JSONB,
    "review_criteria" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "writing_methodologies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "writing_methodologies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "writing_methodologies_project_id_name_key" ON "writing_methodologies"("project_id", "name");
CREATE INDEX "idx_writing_methodologies_lookup" ON "writing_methodologies"("organization_id", "project_id", "is_active");

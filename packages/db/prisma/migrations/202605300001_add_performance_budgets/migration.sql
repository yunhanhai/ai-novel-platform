-- Generation performance budget configuration (per-PR cost guardrails).
-- Reconstructed from the live database so migration history matches deployed schema.

CREATE TYPE "performance_budget_scope" AS ENUM ('organization', 'project');

CREATE TABLE "performance_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "scope" "performance_budget_scope" NOT NULL,
    "warning_cents" INTEGER,
    "critical_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_budgets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_budgets_warning_positive_check" CHECK ("warning_cents" IS NULL OR "warning_cents" > 0),
    CONSTRAINT "performance_budgets_critical_positive_check" CHECK ("critical_cents" IS NULL OR "critical_cents" > 0),
    CONSTRAINT "performance_budgets_threshold_order_check" CHECK ("warning_cents" IS NULL OR "critical_cents" IS NULL OR "critical_cents" >= "warning_cents"),
    CONSTRAINT "performance_budgets_scope_project_check" CHECK (
        ("scope" = 'organization' AND "project_id" IS NULL)
        OR ("scope" = 'project' AND "project_id" IS NOT NULL)
    )
);

CREATE INDEX "idx_perf_budgets_org_scope" ON "performance_budgets"("organization_id", "scope", "is_active");
CREATE INDEX "idx_perf_budgets_project" ON "performance_budgets"("project_id", "is_active");
CREATE UNIQUE INDEX "performance_budgets_one_active_org_default"
    ON "performance_budgets"("organization_id")
    WHERE "is_active" = true AND "scope" = 'organization';
CREATE UNIQUE INDEX "performance_budgets_one_active_project"
    ON "performance_budgets"("organization_id", "project_id")
    WHERE "is_active" = true AND "scope" = 'project';

ALTER TABLE "performance_budgets"
    ADD CONSTRAINT "performance_budgets_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "performance_budgets"
    ADD CONSTRAINT "performance_budgets_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON UPDATE CASCADE ON DELETE CASCADE;

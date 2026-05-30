-- Phase G: 财务治理预算策略与超预算通知
CREATE TABLE "organization_budget_policies" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "monthly_budget_cents" INTEGER NOT NULL DEFAULT 0,
    "monthly_token_quota" INTEGER NOT NULL DEFAULT 0,
    "cycle_anchor_day" INTEGER NOT NULL DEFAULT 1,
    "threshold_percents" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_budget_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "organization_budget_policies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "organization_budget_policies_monthly_budget_cents_check" CHECK ("monthly_budget_cents" >= 0),
    CONSTRAINT "organization_budget_policies_monthly_token_quota_check" CHECK ("monthly_token_quota" >= 0),
    CONSTRAINT "organization_budget_policies_cycle_anchor_day_check" CHECK ("cycle_anchor_day" BETWEEN 1 AND 28)
);
CREATE INDEX "idx_budget_policies_scope" ON "organization_budget_policies"("organization_id", "project_id", "is_active");
CREATE UNIQUE INDEX "organization_budget_policies_org_active_key" ON "organization_budget_policies"("organization_id") WHERE "project_id" IS NULL AND "is_active" = true;
CREATE UNIQUE INDEX "organization_budget_policies_project_active_key" ON "organization_budget_policies"("organization_id", "project_id") WHERE "project_id" IS NOT NULL AND "is_active" = true;

CREATE TABLE "budget_notifications" (
    "id" UUID NOT NULL PRIMARY KEY,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "budget_policy_id" UUID,
    "dedupe_key" VARCHAR(220) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "threshold_percent" INTEGER NOT NULL,
    "actual_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "budget_cents" INTEGER NOT NULL DEFAULT 0,
    "actual_tokens" INTEGER NOT NULL DEFAULT 0,
    "token_quota" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    CONSTRAINT "budget_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
    CONSTRAINT "budget_notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
    CONSTRAINT "budget_notifications_budget_policy_id_fkey" FOREIGN KEY ("budget_policy_id") REFERENCES "organization_budget_policies"("id") ON DELETE SET NULL,
    CONSTRAINT "budget_notifications_threshold_percent_check" CHECK ("threshold_percent" > 0),
    CONSTRAINT "budget_notifications_budget_cents_check" CHECK ("budget_cents" >= 0),
    CONSTRAINT "budget_notifications_token_quota_check" CHECK ("token_quota" >= 0),
    CONSTRAINT "budget_notifications_status_check" CHECK ("status" IN ('open', 'acknowledged'))
);
CREATE UNIQUE INDEX "budget_notifications_dedupe_key_key" ON "budget_notifications"("dedupe_key");
CREATE INDEX "idx_budget_notifications_org_status" ON "budget_notifications"("organization_id", "status", "created_at");
CREATE INDEX "idx_budget_notifications_period" ON "budget_notifications"("organization_id", "period_start");

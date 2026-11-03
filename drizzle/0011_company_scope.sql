ALTER TABLE "accounts" DROP CONSTRAINT "accounts_name_unique";--> statement-breakpoint
ALTER TABLE "vendors" DROP CONSTRAINT "vendors_name_unique";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "entity_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "entity_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_entity_name" ON "accounts" USING btree ("entity_id","name");--> statement-breakpoint
CREATE INDEX "clients_entity" ON "clients" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_entity_name" ON "vendors" USING btree ("entity_id","name");
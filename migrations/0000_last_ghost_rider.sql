CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrollment_id" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"ocr_data" jsonb,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"name" text,
	"cpf" text,
	"date_of_birth" text,
	"income" integer,
	"monthly_expenses" integer,
	"income_category" text,
	"has_formal_employment_history" boolean,
	"has_variable_income" boolean,
	"is_company_active" boolean,
	"has_pro_labore" boolean,
	"household_size" integer,
	"per_capita_income" integer,
	"system_decision" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);

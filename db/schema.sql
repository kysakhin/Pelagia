CREATE SCHEMA "public";
CREATE TABLE "files" (
	"file_id" serial PRIMARY KEY,
	"project_id" integer NOT NULL,
	"filename" text NOT NULL,
	"platform_number" text,
	"data_centre" text,
	"file_size_bytes" bigint,
	"upload_date" timestamp DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "measurements" (
	"measurement_id" bigserial PRIMARY KEY,
	"profile_id" integer NOT NULL,
	"depth_level" integer,
	"pressure" real,
	"pressure_qc" integer,
	"pressure_adjusted" real,
	"pressure_adjusted_qc" integer,
	"temperature" real,
	"temperature_qc" integer,
	"temperature_adjusted" real,
	"temperature_adjusted_qc" integer,
	"salinity" real,
	"salinity_qc" integer,
	"salinity_adjusted" real,
	"salinity_adjusted_qc" integer
);
CREATE TABLE "profiles" (
	"profile_id" serial PRIMARY KEY,
	"file_id" integer NOT NULL,
	"cycle_number" integer,
	"direction" text,
	"latitude" real,
	"longitude" real,
	"position_qc" integer,
	"observed_at" timestamp
);
CREATE TABLE "projects" (
	"project_id" serial PRIMARY KEY,
	"user_id" text NOT NULL UNIQUE,
	"project_name" text NOT NULL UNIQUE,
	"description" text,
	"pi_name" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "projects_user_id_project_name_key" UNIQUE("user_id","project_name")
);
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY,
	"email" text NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"full_name" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "files_pkey" ON "files" ("file_id");
CREATE INDEX "idx_files_project_id" ON "files" ("project_id");
CREATE INDEX "idx_measurements_depth" ON "measurements" ("depth_level");
CREATE INDEX "idx_measurements_profile_id" ON "measurements" ("profile_id");
CREATE UNIQUE INDEX "measurements_pkey" ON "measurements" ("measurement_id");
CREATE INDEX "idx_profiles_file_id" ON "profiles" ("file_id");
CREATE INDEX "idx_profiles_lat_lon" ON "profiles" ("latitude","longitude");
CREATE INDEX "idx_profiles_observed_at" ON "profiles" ("observed_at");
CREATE UNIQUE INDEX "profiles_pkey" ON "profiles" ("profile_id");
CREATE INDEX "idx_projects_user_id" ON "projects" ("user_id");
CREATE UNIQUE INDEX "projects_pkey" ON "projects" ("project_id");
CREATE UNIQUE INDEX "projects_user_id_project_name_key" ON "projects" ("user_id","project_name");
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
CREATE UNIQUE INDEX "users_pkey" ON "users" ("user_id");
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE;
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id") ON DELETE CASCADE;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("file_id") ON DELETE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE;
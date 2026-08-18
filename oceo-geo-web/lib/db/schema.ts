import {
  bigint,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── projects ────────────────────────────────────────────────────────────────
export const projects = pgTable(
  "projects",
  {
    projectId: serial("project_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    description: text("description"),
    piName: text("pi_name"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_user_id_project_name_key").on(t.userId, t.projectName),
    index("idx_projects_user_id").on(t.userId),
  ]
);

// ── files ───────────────────────────────────────────────────────────────────
export const files = pgTable(
  "files",
  {
    fileId: serial("file_id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    platformNumber: text("platform_number"),
    dataCentre: text("data_centre"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    uploadDate: timestamp("upload_date").defaultNow(),
    fileType: text("file_type").default("CORE"),
  },
  (t) => [index("idx_files_project_id").on(t.projectId)]
);

// ── profiles ────────────────────────────────────────────────────────────────
export const profiles = pgTable(
  "profiles",
  {
    profileId: serial("profile_id").primaryKey(),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.fileId, { onDelete: "cascade" }),
    cycleNumber: integer("cycle_number"),
    direction: text("direction"),
    dataMode: text("data_mode"),
    latitude: integer("latitude"),
    longitude: integer("longitude"),
    positionQc: integer("position_qc"),
    observedAt: timestamp("observed_at"),
  },
  (t) => [
    index("idx_profiles_file_id").on(t.fileId),
    index("idx_profiles_lat_lon").on(t.latitude, t.longitude),
    index("idx_profiles_observed_at").on(t.observedAt),
  ]
);

// ── measurements ────────────────────────────────────────────────────────────
export const measurements = pgTable(
  "measurements",
  {
    measurementId: bigint("measurement_id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.profileId, { onDelete: "cascade" }),
    depthLevel: integer("depth_level"),

    // Core Argo parameters (typed columns)
    pressure: integer("pressure"),
    pressureQc: integer("pressure_qc"),
    pressureAdjusted: integer("pressure_adjusted"),
    pressureAdjustedQc: integer("pressure_adjusted_qc"),
    temperature: integer("temperature"),
    temperatureQc: integer("temperature_qc"),
    temperatureAdjusted: integer("temperature_adjusted"),
    temperatureAdjustedQc: integer("temperature_adjusted_qc"),
    salinity: integer("salinity"),
    salinityQc: integer("salinity_qc"),
    salinityAdjusted: integer("salinity_adjusted"),
    salinityAdjustedQc: integer("salinity_adjusted_qc"),

    // BGC parameters (flat JSONB)
    extras: jsonb("extras"),
  },
  (t) => [
    index("idx_measurements_profile_id").on(t.profileId),
    index("idx_measurements_depth").on(t.depthLevel),
  ]
);

// ── conversations ───────────────────────────────────────────────────────────
export const conversations = pgTable(
  "conversations",
  {
    conversationId: serial("conversation_id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_conversations_project").on(t.projectId),
    index("idx_conversations_user").on(t.userId),
  ]
);

// ── messages ────────────────────────────────────────────────────────────────
export const messages = pgTable(
  "messages",
  {
    messageId: bigint("message_id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.conversationId, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user' | 'assistant' | 'system'
    content: text("content"),
    intent: text("intent"),
    sqlQuery: text("sql_query"),
    sqlData: jsonb("sql_data"),
    chartSpec: jsonb("chart_spec"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("idx_messages_conversation").on(t.conversationId)]
);

// ── project_parameters ──────────────────────────────────────────────────────
export const projectParameters = pgTable(
  "project_parameters",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    parameterName: text("parameter_name").notNull(),
    measurementCount: bigint("measurement_count", { mode: "number" }).default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.parameterName] })]
);

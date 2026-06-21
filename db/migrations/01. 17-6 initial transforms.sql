/*
Initial migrations to include bgc parametesr to measurements table.
Added new table to store project parameters in SQL so its discoverable by the agent.
Tables for storing user conversations.
*/

BEGIN;

-- 1. Add extras JSONB to measurements (BGC parameters)
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS extras JSONB;

-- 2. Add new columns to existing tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS data_mode TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'CORE';

-- 3. Create project_parameters catalog
CREATE TABLE IF NOT EXISTS project_parameters (
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parameter_name  TEXT NOT NULL,
    measurement_count BIGINT DEFAULT 0,
    PRIMARY KEY (project_id, parameter_name)
);

-- 4. Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id SERIAL PRIMARY KEY,
    project_id      INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create messages table
CREATE TABLE IF NOT EXISTS messages (
    message_id      BIGSERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT,
    intent          TEXT,
    sql_query       TEXT,
    sql_data        JSONB,
    chart_spec      JSONB,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Add indexes
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

COMMIT;
// ============================================================================
// Session & Memory Management - Self-contained SQLite-based store
// ============================================================================
//
// Architecture:
// ┌─────────────────────────────────────┐
// │     Session Store (SQLite)          │
// ├─────────────────────────────────────┤
// │  - Sessions (id, created, metadata) │
// │  - Messages (session_id, role, etc) │
// │  - Episodic Memory (cross-session)  │
// └─────────────────────────────────────┘

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use parking_lot::Mutex;
use chrono::{DateTime, Utc};

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub model: Option<String>,
    pub title: Option<String>,
    pub message_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: i64,
    pub session_id: String,
    pub role: String,        // "user", "assistant", "system"
    pub content: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>, // JSON for attachments, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodicMemory {
    pub id: i64,
    pub event_type: String,  // "conversation", "model_switch", "error", etc.
    pub summary: String,
    pub session_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContext {
    pub session: Session,
    pub messages: Vec<SessionMessage>,
    pub recent_memory: Vec<EpisodicMemory>,
}

// ============================================================================
// Session Store
// ============================================================================

pub struct SessionStore {
    conn: Arc<Mutex<Connection>>,
}

impl SessionStore {
    /// Create a new session store with SQLite database at the given path
    pub fn new(db_path: &Path) -> Result<Self, rusqlite::Error> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;

        // Initialize schema
        conn.execute_batch(
            r#"
            -- Sessions table
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                model TEXT,
                title TEXT,
                message_count INTEGER DEFAULT 0
            );

            -- Messages table
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            -- Episodic memory table (cross-session learnings)
            CREATE TABLE IF NOT EXISTS episodic_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                session_id TEXT,
                created_at TEXT NOT NULL,
                metadata TEXT
            );

            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
            CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(event_type);
            CREATE INDEX IF NOT EXISTS idx_episodic_created ON episodic_memory(created_at);
            "#
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    // ========================================================================
    // Session Management
    // ========================================================================

    /// Create a new session, returns the session ID
    pub fn create_session(&self, model: Option<&str>, title: Option<&str>) -> Result<Session, rusqlite::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sessions (id, created_at, updated_at, model, title, message_count) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![id, now, now, model, title],
        )?;

        Ok(Session {
            id,
            created_at: now.clone(),
            updated_at: now,
            model: model.map(String::from),
            title: title.map(String::from),
            message_count: 0,
        })
    }

    /// Get session by ID
    pub fn get_session(&self, session_id: &str) -> Result<Option<Session>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, created_at, updated_at, model, title, message_count FROM sessions WHERE id = ?1"
        )?;

        let session = stmt.query_row(params![session_id], |row| {
            Ok(Session {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                model: row.get(3)?,
                title: row.get(4)?,
                message_count: row.get(5)?,
            })
        }).optional()?;

        Ok(session)
    }

    /// List recent sessions
    pub fn list_sessions(&self, limit: usize) -> Result<Vec<Session>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, created_at, updated_at, model, title, message_count
             FROM sessions ORDER BY updated_at DESC LIMIT ?1"
        )?;

        let sessions = stmt.query_map(params![limit as i64], |row| {
            Ok(Session {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                model: row.get(3)?,
                title: row.get(4)?,
                message_count: row.get(5)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();

        Ok(sessions)
    }

    /// Delete a session and all its messages
    pub fn delete_session(&self, session_id: &str) -> Result<bool, rusqlite::Error> {
        let conn = self.conn.lock();

        // Delete messages first (CASCADE should handle this, but be explicit)
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])?;

        let deleted = conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(deleted > 0)
    }

    /// Clear all sessions (full reset)
    pub fn clear_all_sessions(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM messages", [])?;
        conn.execute("DELETE FROM sessions", [])?;
        Ok(())
    }

    // ========================================================================
    // Message Management
    // ========================================================================

    /// Add a message to a session
    pub fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        metadata: Option<&str>,
    ) -> Result<SessionMessage, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock();

        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, role, content, now, metadata],
        )?;

        let id = conn.last_insert_rowid();

        // Update session message count and timestamp
        conn.execute(
            "UPDATE sessions SET message_count = message_count + 1, updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;

        Ok(SessionMessage {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now,
            metadata: metadata.map(String::from),
        })
    }

    /// Get all messages for a session
    pub fn get_messages(&self, session_id: &str) -> Result<Vec<SessionMessage>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at, metadata
             FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        )?;

        let messages = stmt.query_map(params![session_id], |row| {
            Ok(SessionMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                metadata: row.get(5)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();

        Ok(messages)
    }

    /// Get recent messages for context (last N messages)
    pub fn get_recent_messages(&self, session_id: &str, limit: usize) -> Result<Vec<SessionMessage>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at, metadata
             FROM messages WHERE session_id = ?1
             ORDER BY created_at DESC LIMIT ?2"
        )?;

        let mut messages: Vec<SessionMessage> = stmt.query_map(params![session_id, limit as i64], |row| {
            Ok(SessionMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                metadata: row.get(5)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();

        // Reverse to get chronological order
        messages.reverse();
        Ok(messages)
    }

    // ========================================================================
    // Episodic Memory (Cross-Session Learning)
    // ========================================================================

    /// Record an event to episodic memory
    pub fn record_memory(
        &self,
        event_type: &str,
        summary: &str,
        session_id: Option<&str>,
        metadata: Option<&str>,
    ) -> Result<EpisodicMemory, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock();

        conn.execute(
            "INSERT INTO episodic_memory (event_type, summary, session_id, created_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![event_type, summary, session_id, now, metadata],
        )?;

        let id = conn.last_insert_rowid();

        Ok(EpisodicMemory {
            id,
            event_type: event_type.to_string(),
            summary: summary.to_string(),
            session_id: session_id.map(String::from),
            created_at: now,
            metadata: metadata.map(String::from),
        })
    }

    /// Get recent episodic memories
    pub fn get_recent_memories(&self, limit: usize) -> Result<Vec<EpisodicMemory>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, summary, session_id, created_at, metadata
             FROM episodic_memory ORDER BY created_at DESC LIMIT ?1"
        )?;

        let memories = stmt.query_map(params![limit as i64], |row| {
            Ok(EpisodicMemory {
                id: row.get(0)?,
                event_type: row.get(1)?,
                summary: row.get(2)?,
                session_id: row.get(3)?,
                created_at: row.get(4)?,
                metadata: row.get(5)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();

        Ok(memories)
    }

    /// Get memories by type
    pub fn get_memories_by_type(&self, event_type: &str, limit: usize) -> Result<Vec<EpisodicMemory>, rusqlite::Error> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, summary, session_id, created_at, metadata
             FROM episodic_memory WHERE event_type = ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;

        let memories = stmt.query_map(params![event_type, limit as i64], |row| {
            Ok(EpisodicMemory {
                id: row.get(0)?,
                event_type: row.get(1)?,
                summary: row.get(2)?,
                session_id: row.get(3)?,
                created_at: row.get(4)?,
                metadata: row.get(5)?,
            })
        })?
        .filter_map(Result::ok)
        .collect();

        Ok(memories)
    }

    /// Clear episodic memory (optional reset)
    pub fn clear_memories(&self) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM episodic_memory", [])?;
        Ok(())
    }

    // ========================================================================
    // Context Building
    // ========================================================================

    /// Get full session context for inference
    pub fn get_session_context(&self, session_id: &str, max_messages: usize, max_memories: usize) -> Result<Option<SessionContext>, rusqlite::Error> {
        let session = self.get_session(session_id)?;

        match session {
            Some(session) => {
                let messages = self.get_recent_messages(session_id, max_messages)?;
                let recent_memory = self.get_recent_memories(max_memories)?;

                Ok(Some(SessionContext {
                    session,
                    messages,
                    recent_memory,
                }))
            }
            None => Ok(None),
        }
    }

    /// Update session title (auto-generate from first message)
    pub fn update_session_title(&self, session_id: &str, title: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, Utc::now().to_rfc3339(), session_id],
        )?;
        Ok(())
    }

    /// Update session model
    pub fn update_session_model(&self, session_id: &str, model: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE sessions SET model = ?1, updated_at = ?2 WHERE id = ?3",
            params![model, Utc::now().to_rfc3339(), session_id],
        )?;
        Ok(())
    }
}

// Make SessionStore thread-safe
unsafe impl Send for SessionStore {}
unsafe impl Sync for SessionStore {}

impl Clone for SessionStore {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
        }
    }
}

// ============================================================================
// Helper trait for optional results
// ============================================================================

trait OptionalResult<T> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error>;
}

impl<T> OptionalResult<T> for Result<T, rusqlite::Error> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn test_session_lifecycle() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let store = SessionStore::new(&db_path).unwrap();

        // Create session
        let session = store.create_session(Some("llama-7b"), Some("Test Chat")).unwrap();
        assert!(!session.id.is_empty());

        // Add messages
        store.add_message(&session.id, "user", "Hello!", None).unwrap();
        store.add_message(&session.id, "assistant", "Hi there!", None).unwrap();

        // Get messages
        let messages = store.get_messages(&session.id).unwrap();
        assert_eq!(messages.len(), 2);

        // Get session (should have updated message count)
        let updated = store.get_session(&session.id).unwrap().unwrap();
        assert_eq!(updated.message_count, 2);

        // Delete session
        let deleted = store.delete_session(&session.id).unwrap();
        assert!(deleted);

        // Verify deleted
        let gone = store.get_session(&session.id).unwrap();
        assert!(gone.is_none());
    }

    #[test]
    fn test_episodic_memory() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let store = SessionStore::new(&db_path).unwrap();

        // Record memories
        store.record_memory("conversation", "User asked about weather", None, None).unwrap();
        store.record_memory("model_switch", "Switched from llama-7b to llama-13b", None, None).unwrap();

        // Get all memories
        let memories = store.get_recent_memories(10).unwrap();
        assert_eq!(memories.len(), 2);

        // Get by type
        let conv_memories = store.get_memories_by_type("conversation", 10).unwrap();
        assert_eq!(conv_memories.len(), 1);
    }
}

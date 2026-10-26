#![cfg(feature = "automation")]

//! Databases for the automation runner: SQLite, PostgreSQL, MySQL/MariaDB and
//! MongoDB.
//!
//! One `db.open` step points at a database (a SQLite file, or a connection
//! string for the others) and keeps the connection under a name; every later
//! `db.exec` / `db.query` step names it. Connections live for the run and are
//! dropped when it finishes, the same lifetime the request sessions have.
//!
//! Every driver here is the SYNCHRONOUS client, so one small registry holds
//! them all; the runner calls these functions from a blocking task so a network
//! round-trip never ties up an async worker thread.
//!
//! SQL drivers take SQL in both steps. MongoDB is not SQL: its statement is a
//! JSON command document run with runCommand — a query returns the command's
//! `cursor.firstBatch` when there is one, otherwise the whole result document.

use anyhow::{anyhow, Result};
use rusqlite::types::ValueRef;
use rusqlite::Connection as SqliteConn;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

enum Handle {
    Sqlite(SqliteConn),
    Postgres(postgres::Client),
    Mysql(mysql::Conn),
    Mongo(mongodb::sync::Database),
}

fn conns() -> &'static Mutex<HashMap<String, Handle>> {
    static C: OnceLock<Mutex<HashMap<String, Handle>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Opens a database and keeps it under `name`.
///
/// `driver`: "sqlite" (default), "postgres", "mysql"/"mariadb", "mongodb".
/// `target`: for sqlite a file path (empty/":memory:" = in-memory); for the
/// others a connection string. `database`: MongoDB's database when it is not in
/// the URI.
pub fn open(name: &str, driver: &str, target: &str, database: Option<&str>) -> Result<()> {
    let handle = match driver.trim().to_ascii_lowercase().as_str() {
        "" | "sqlite" => {
            let t = target.trim();
            if t.is_empty() || t == ":memory:" {
                Handle::Sqlite(SqliteConn::open_in_memory()?)
            } else {
                if let Some(dir) = std::path::Path::new(t).parent() {
                    if !dir.as_os_str().is_empty() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                }
                Handle::Sqlite(SqliteConn::open(t)?)
            }
        }
        "postgres" | "postgresql" | "pg" => {
            // NoTls: a TLS connector is a later addition; local/dev servers and
            // sslmode=disable work now.
            Handle::Postgres(postgres::Client::connect(target, postgres::NoTls)?)
        }
        "mysql" | "mariadb" => {
            let opts = mysql::Opts::from_url(target)?;
            Handle::Mysql(mysql::Conn::new(opts)?)
        }
        "mongodb" | "mongo" => {
            let client = mongodb::sync::Client::with_uri_str(target)?;
            let db = match database {
                Some(d) if !d.trim().is_empty() => client.database(d.trim()),
                _ => client
                    .default_database()
                    .ok_or_else(|| anyhow!("mongodb needs a database — put it in the URI or the database field"))?,
            };
            Handle::Mongo(db)
        }
        other => return Err(anyhow!("unknown database driver \"{other}\"")),
    };
    conns()
        .lock()
        .map_err(|_| anyhow!("db lock poisoned"))?
        .insert(name.to_string(), handle);
    Ok(())
}

fn sqlite_ref_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => json!(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            json!(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

fn mysql_value_to_json(v: &mysql::Value) -> Value {
    use mysql::Value as V;
    match v {
        V::NULL => Value::Null,
        V::Int(i) => json!(i),
        V::UInt(u) => json!(u),
        V::Float(f) => json!(f),
        V::Double(d) => json!(d),
        V::Bytes(b) => json!(String::from_utf8_lossy(b).to_string()),
        // Dates/times have no JSON form; the SQL literal (quotes trimmed) is the
        // readable one.
        other => json!(other.as_sql(true).trim_matches('\'').to_string()),
    }
}

/// Runs statements that return no rows. Returns `{ changes, lastInsertId }` for
/// SQL drivers, or the command result document for MongoDB.
pub fn exec(name: &str, statement: &str) -> Result<Value> {
    let mut g = conns().lock().map_err(|_| anyhow!("db lock poisoned"))?;
    let handle = g
        .get_mut(name)
        .ok_or_else(|| anyhow!("no open database \"{name}\" — add a db.open step first"))?;
    match handle {
        Handle::Sqlite(c) => {
            c.execute_batch(statement)?;
            Ok(json!({ "changes": c.changes(), "lastInsertId": c.last_insert_rowid() }))
        }
        Handle::Postgres(c) => {
            let msgs = c.simple_query(statement)?;
            let mut changes: u64 = 0;
            for m in msgs {
                if let postgres::SimpleQueryMessage::CommandComplete(n) = m {
                    changes = n;
                }
            }
            Ok(json!({ "changes": changes }))
        }
        Handle::Mysql(c) => {
            use mysql::prelude::Queryable;
            c.query_drop(statement)?;
            Ok(json!({ "changes": c.affected_rows(), "lastInsertId": c.last_insert_id() }))
        }
        Handle::Mongo(db) => {
            let json: Value = serde_json::from_str(statement)
                .map_err(|e| anyhow!("mongodb command is not valid JSON: {e}"))?;
            let cmd = mongodb::bson::to_document(&json)
                .map_err(|e| anyhow!("mongodb command must be a JSON object: {e}"))?;
            let res = db.run_command(cmd).run()?;
            Ok(mongodb::bson::Bson::Document(res).into_relaxed_extjson())
        }
    }
}

/// Runs a query and returns the column names (in order) and the rows as objects
/// keyed by column name. For MongoDB the statement is a JSON command; rows are
/// its `cursor.firstBatch` when present, else the whole result as one row.
pub fn query(name: &str, statement: &str) -> Result<(Vec<String>, Vec<Value>)> {
    let mut g = conns().lock().map_err(|_| anyhow!("db lock poisoned"))?;
    let handle = g
        .get_mut(name)
        .ok_or_else(|| anyhow!("no open database \"{name}\" — add a db.open step first"))?;
    match handle {
        Handle::Sqlite(c) => {
            let mut stmt = c.prepare(statement)?;
            let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mapped = stmt.query_map([], |row| {
                let mut obj = Map::new();
                for (i, col) in cols.iter().enumerate() {
                    obj.insert(col.clone(), sqlite_ref_to_json(row.get_ref(i)?));
                }
                Ok(Value::Object(obj))
            })?;
            let mut out = Vec::new();
            for r in mapped {
                out.push(r?);
            }
            Ok((cols, out))
        }
        Handle::Postgres(c) => {
            let msgs = c.simple_query(statement)?;
            let mut cols: Vec<String> = Vec::new();
            let mut out: Vec<Value> = Vec::new();
            for m in msgs {
                if let postgres::SimpleQueryMessage::Row(row) = m {
                    if cols.is_empty() {
                        cols = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                    let mut obj = Map::new();
                    for (i, col) in cols.iter().enumerate() {
                        let v = match row.get(i) {
                            Some(s) => Value::String(s.to_string()),
                            None => Value::Null,
                        };
                        obj.insert(col.clone(), v);
                    }
                    out.push(Value::Object(obj));
                }
            }
            Ok((cols, out))
        }
        Handle::Mysql(c) => {
            use mysql::prelude::Queryable;
            let mut result = c.query_iter(statement)?;
            let cols: Vec<String> = result
                .columns()
                .as_ref()
                .iter()
                .map(|col| col.name_str().to_string())
                .collect();
            let mut out: Vec<Value> = Vec::new();
            for row in result.by_ref() {
                let row = row?;
                let mut obj = Map::new();
                for (i, col) in cols.iter().enumerate() {
                    let v = row.as_ref(i).map(mysql_value_to_json).unwrap_or(Value::Null);
                    obj.insert(col.clone(), v);
                }
                out.push(Value::Object(obj));
            }
            Ok((cols, out))
        }
        Handle::Mongo(db) => {
            let json: Value = serde_json::from_str(statement)
                .map_err(|e| anyhow!("mongodb command is not valid JSON: {e}"))?;
            let cmd = mongodb::bson::to_document(&json)
                .map_err(|e| anyhow!("mongodb command must be a JSON object: {e}"))?;
            let res = db.run_command(cmd).run()?;
            let as_json = mongodb::bson::Bson::Document(res).into_relaxed_extjson();
            // A find/aggregate command answers with cursor.firstBatch; hand those
            // back as the rows. Anything else is one row: the whole document.
            let rows = as_json
                .get("cursor")
                .and_then(|c| c.get("firstBatch"))
                .and_then(|b| b.as_array())
                .cloned()
                .unwrap_or_else(|| vec![as_json.clone()]);
            Ok((Vec::new(), rows))
        }
    }
}

/// A JSON value as a plain variable string: text without quotes, null as empty.
pub fn scalar_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Forgets one connection.
pub fn close(name: &str) {
    if let Ok(mut g) = conns().lock() {
        g.remove(name);
    }
}

/// Forgets every connection. Called when a run finishes.
pub fn drop_all() {
    if let Ok(mut g) = conns().lock() {
        g.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_open_exec_query_roundtrip() {
        let name = "test_conn_rt";
        open(name, "sqlite", ":memory:", None).unwrap();
        exec(name, "CREATE TABLE t(id INTEGER PRIMARY KEY, who TEXT, n REAL);").unwrap();
        let out = exec(name, "INSERT INTO t(who, n) VALUES ('ada', 1.5), ('bob', 2.0);").unwrap();
        assert_eq!(out.get("changes").unwrap().as_i64().unwrap(), 2);

        let (cols, rows) = query(name, "SELECT who, n FROM t ORDER BY id;").unwrap();
        assert_eq!(cols, vec!["who".to_string(), "n".to_string()]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get("who").unwrap().as_str().unwrap(), "ada");
        assert_eq!(rows[0].get("n").unwrap().as_f64().unwrap(), 1.5);

        let first = rows.first().unwrap().as_object().unwrap();
        assert_eq!(scalar_to_string(first.get(&cols[0]).unwrap()), "ada");

        close(name);
        assert!(query(name, "SELECT 1;").is_err());
    }

    #[test]
    fn missing_connection_errors() {
        assert!(exec("nope_conn", "SELECT 1;").is_err());
        assert!(query("nope_conn", "SELECT 1;").is_err());
    }

    #[test]
    fn unknown_driver_errors() {
        assert!(open("x", "oracle", "whatever", None).is_err());
    }
}

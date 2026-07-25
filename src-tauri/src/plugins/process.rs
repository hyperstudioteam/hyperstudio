use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use crate::plugins::rpc::{JsonRpcRequest, JsonRpcResponse};

const PLUGIN_CALL_TIMEOUT: Duration = Duration::from_secs(120);

enum PluginCommand {
    Call(JsonRpcRequest, oneshot::Sender<Result<Value, String>>),
    Cancel(u64),
}

#[derive(Clone)]
pub struct PluginProcess {
    sender: mpsc::Sender<PluginCommand>,
}

impl PluginProcess {
    pub async fn spawn(
        executable: PathBuf,
        settings: Value,
    ) -> Result<Self, String> {
        let mut child = Command::new(&executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to spawn plugin '{}': {error}",
                    executable.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Plugin stdin unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Plugin stdout unavailable.".to_string())?;

        let (tx, rx) = mpsc::channel::<PluginCommand>(64);
        tokio::spawn(run_actor(child, stdin, stdout, rx));

        let process = Self { sender: tx };
        // Best-effort initialize; ignore method-not-found style failures.
        let _ = process
            .call(
                "initialize",
                serde_json::json!({ "settings": settings }),
            )
            .await;
        Ok(process)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let request = JsonRpcRequest::new(id, method, params);
        let (resp_tx, resp_rx) = oneshot::channel();
        self.sender
            .send(PluginCommand::Call(request, resp_tx))
            .await
            .map_err(|_| "Plugin process is not running.".to_string())?;

        match timeout(PLUGIN_CALL_TIMEOUT, resp_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Plugin did not respond.".into()),
            Err(_) => {
                let _ = self.sender.send(PluginCommand::Cancel(id)).await;
                Err(format!(
                    "Plugin call '{method}' timed out after {}s",
                    PLUGIN_CALL_TIMEOUT.as_secs()
                ))
            }
        }
    }
}

async fn run_actor(
    mut child: Child,
    mut stdin: ChildStdin,
    stdout: tokio::process::ChildStdout,
    mut rx: mpsc::Receiver<PluginCommand>,
) {
    let mut reader = BufReader::new(stdout).lines();
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(PluginCommand::Call(req, resp_tx)) => {
                    pending.insert(req.id, resp_tx);
                    match serde_json::to_string(&req) {
                        Ok(mut line) => {
                            line.push('\n');
                            if let Err(error) = stdin.write_all(line.as_bytes()).await {
                                if let Some(tx) = pending.remove(&req.id) {
                                    let _ = tx.send(Err(format!("Failed to write to plugin: {error}")));
                                }
                            }
                        }
                        Err(error) => {
                            if let Some(tx) = pending.remove(&req.id) {
                                let _ = tx.send(Err(format!("Failed to encode request: {error}")));
                            }
                        }
                    }
                }
                Some(PluginCommand::Cancel(id)) => {
                    pending.remove(&id);
                }
                None => {
                    let _ = child.kill().await;
                    break;
                }
            },

            line = reader.next_line() => match line {
                Ok(Some(text)) => {
                    match serde_json::from_str::<JsonRpcResponse>(&text) {
                        Ok(JsonRpcResponse::Success { result, id, .. }) => {
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(Ok(result));
                            }
                        }
                        Ok(JsonRpcResponse::Error { error, id, .. }) => {
                            if let Some(tx) = pending.remove(&id) {
                                let _ = tx.send(Err(error.message));
                            }
                        }
                        Err(error) => {
                            eprintln!("bad response from plugin: {error}: {text}");
                        }
                    }
                }
                Ok(None) => {
                    for (_, tx) in pending.drain() {
                        let _ = tx.send(Err("Plugin process exited.".into()));
                    }
                    let _ = child.kill().await;
                    break;
                }
                Err(error) => {
                    eprintln!("plugin read error: {error}");
                    for (_, tx) in pending.drain() {
                        let _ = tx.send(Err(format!("Plugin read error: {error}")));
                    }
                    let _ = child.kill().await;
                    break;
                }
            }
        }
    }
}

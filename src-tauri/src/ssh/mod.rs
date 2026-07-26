//! Local SSH port forwards for database connections.
//!
//! When a profile enables SSH, HyperStudio opens an SSH session, binds a
//! loopback port, and for every accepted TCP connection opens a
//! `direct-tcpip` channel to the database host as seen from the SSH server.
//! Drivers then dial `127.0.0.1:<local>` instead of the remote address.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use async_ssh2_tokio::client::{AuthMethod, Client, ServerCheckMethod};
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};
use tokio::task::JoinHandle;

use crate::models::SshTunnelConfig;

pub struct TunnelHandle {
    #[allow(dead_code)]
    local_port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    accept_task: JoinHandle<()>,
    /// Keep the SSH client alive for the life of the tunnel.
    _client: Client,
}

impl TunnelHandle {
    pub async fn close(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = self.accept_task.await;
    }
}

#[derive(Default)]
pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, TunnelHandle>>,
}

impl TunnelManager {
    pub async fn open(
        &self,
        connection_id: &str,
        ssh: &SshTunnelConfig,
        target_host: &str,
        target_port: u16,
    ) -> Result<u16, String> {
        self.close(connection_id).await;

        let auth = auth_method(ssh)?;
        let client = Client::connect(
            (ssh.host.as_str(), ssh.port),
            &ssh.username,
            auth,
            // Host key checks belong to a follow-up; rejecting unknown hosts
            // would block first-time tunnels with no UI to accept them yet.
            ServerCheckMethod::NoCheck,
        )
        .await
        .map_err(|error| format!("SSH connect failed: {error}"))?;

        let listener = TcpListener::bind(("127.0.0.1", 0u16))
            .await
            .map_err(|error| format!("Could not bind local tunnel port: {error}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let target_host = target_host.to_string();
        let client_clone = client.clone();

        let accept_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((mut local, peer)) = accepted else { break };
                        let client = client_clone.clone();
                        let target_host = target_host.clone();
                        tokio::spawn(async move {
                            if let Err(error) = relay(
                                &client,
                                &mut local,
                                &target_host,
                                target_port,
                                peer,
                            )
                            .await
                            {
                                eprintln!("SSH tunnel relay ended: {error}");
                            }
                        });
                    }
                }
            }
        });

        let handle = TunnelHandle {
            local_port,
            shutdown: Some(shutdown_tx),
            accept_task,
            _client: client,
        };
        self.tunnels
            .lock()
            .await
            .insert(connection_id.to_string(), handle);
        Ok(local_port)
    }

    pub async fn close(&self, connection_id: &str) {
        if let Some(handle) = self.tunnels.lock().await.remove(connection_id) {
            handle.close().await;
        }
    }
}

fn auth_method(ssh: &SshTunnelConfig) -> Result<AuthMethod, String> {
    match ssh.auth.as_str() {
        "key" | "privateKey" => {
            let path = expand_home(ssh.private_key_path.trim());
            if path.is_empty() {
                return Err("SSH private key path is required.".into());
            }
            let passphrase = ssh.passphrase.trim();
            Ok(AuthMethod::with_key_file(
                &path,
                if passphrase.is_empty() {
                    None
                } else {
                    Some(passphrase)
                },
            ))
        }
        "agent" => Ok(AuthMethod::with_agent()),
        _ => {
            if ssh.password.is_empty() {
                return Err("SSH password is required.".into());
            }
            Ok(AuthMethod::with_password(&ssh.password))
        }
    }
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return std::path::Path::new(&home)
                .join(rest)
                .to_string_lossy()
                .into_owned();
        }
    }
    path.to_string()
}

async fn relay(
    client: &Client,
    local: &mut tokio::net::TcpStream,
    target_host: &str,
    target_port: u16,
    peer: SocketAddr,
) -> Result<(), String> {
    let channel = client
        .open_direct_tcpip_channel((target_host, target_port), Some(peer))
        .await
        .map_err(|error| format!("SSH forward failed: {error}"))?;
    let mut stream = channel.into_stream();
    let _ = copy_bidirectional(local, &mut stream).await;
    Ok(())
}

/// Rewrite a config so drivers dial the local tunnel instead of the remote host.
pub fn apply_local_endpoint(
    mut config: crate::models::ConnectionConfig,
    local_port: u16,
) -> crate::models::ConnectionConfig {
    config.host = "127.0.0.1".into();
    config.port = local_port;
    // TLS to a loopback forward often fails hostname checks; prefer plain
    // when the tunnel already encrypts the hop to the bastion. Users who need
    // end-to-end TLS through the tunnel can set require explicitly later.
    if config.ssl_mode == "prefer" {
        config.ssl_mode = "disable".into();
    }
    config
}

pub type SharedTunnels = Arc<TunnelManager>;

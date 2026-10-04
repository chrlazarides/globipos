//! The same provision catalogue is consumed by the peripheral settings UI.
use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
pub struct ScaleProtocol {
    pub id: String,
    pub label: String,
    pub adapter: bool,
}

pub static SCALE_PROTOCOLS: LazyLock<Vec<ScaleProtocol>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../scale-protocols.json"))
        .expect("Built-in scale protocol catalogue must be valid")
});

pub fn validate_protocol(id: &str) -> Result<&'static ScaleProtocol, String> {
    SCALE_PROTOCOLS.iter().find(|protocol| protocol.id == id)
        .ok_or_else(|| format!("Unknown scale protocol: {}", id))
}

pub fn require_physical_adapter(id: &str) -> Result<(), String> {
    let protocol = validate_protocol(id)?;
    if !protocol.adapter {
        return Err(format!("{}: provision only; physical adapter and model verification pending. Use Simulator for now.", protocol.label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_is_unique_and_pending_profiles_cannot_access_hardware() {
        let mut ids = std::collections::HashSet::new();
        for protocol in SCALE_PROTOCOLS.iter() {
            assert!(ids.insert(&protocol.id));
            assert!(!protocol.label.is_empty());
            assert_eq!(require_physical_adapter(&protocol.id).is_ok(), protocol.adapter);
        }
        assert!(validate_protocol("unknown").is_err());
        assert!(SCALE_PROTOCOLS.iter().any(|protocol| protocol.id == "custom"));
    }

    #[tokio::test]
    async fn every_provision_can_be_saved_in_simulator_mode() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        crate::migrations::run_migrations(&pool).await.unwrap();
        for protocol in SCALE_PROTOCOLS.iter() {
            let cfg = crate::hardware::HardwareConfig {
                scale_enabled: true,
                scale_mode: crate::scale_simulator::ScaleMode::Simulated,
                scale_protocol: protocol.id.clone(),
                scale_profile: "Test model / protocol variant".into(),
                ..Default::default()
            };
            crate::hardware::save_hardware_config(&pool, &cfg).await.unwrap();
            let loaded = crate::hardware::load_hardware_config(&pool).await;
            assert_eq!(loaded.scale_protocol, protocol.id);
            assert_eq!(loaded.scale_profile, cfg.scale_profile);
            assert_eq!(loaded.scale_simulation.read().unwrap().kg, 0.75);
        }
        let invalid_custom = crate::hardware::HardwareConfig {
            scale_enabled: true, scale_protocol: "custom".into(), ..Default::default()
        };
        assert!(crate::hardware::save_hardware_config(&pool, &invalid_custom).await.is_err());
    }
}
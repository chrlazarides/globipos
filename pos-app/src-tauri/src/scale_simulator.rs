//! Explicit test peripheral; never a fallback for a failed physical scale.
use serde::{Deserialize, Serialize};
use crate::hardware::ScaleWeight;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScaleMode { #[default] Physical, Simulated }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScaleSimulation {
    pub value: f64,
    pub unit: String,
    pub state: String,
    pub tared: bool,
}

impl Default for ScaleSimulation {
    fn default() -> Self {
        Self { value: 0.75, unit: "kg".into(), state: "stable".into(), tared: false }
    }
}

impl ScaleSimulation {
    pub fn validate(&self) -> Result<(), String> {
        if !self.value.is_finite() || self.value < 0.0 {
            return Err("Simulated weight must be a finite, non-negative number".into());
        }
        if !["kg", "g"].contains(&self.unit.as_str()) {
            return Err("Simulated scale unit must be kg or g".into());
        }
        if !["stable", "unstable", "disconnected"].contains(&self.state.as_str()) {
            return Err("Unknown simulated scale state".into());
        }
        Ok(())
    }

    pub fn read(&self) -> Result<ScaleWeight, String> {
        self.validate()?;
        if self.state == "disconnected" {
            return Err("Simulated scale disconnected".into());
        }
        let grams = if self.unit == "kg" { self.value * 1000.0 } else { self.value };
        if !grams.is_finite() { return Err("Simulated weight is too large".into()); }
        Ok(ScaleWeight {
            grams, kg: grams / 1000.0, stable: self.state == "stable", tared: self.tared,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kg_and_grams_produce_identical_readings() {
        let kg = ScaleSimulation::default().read().unwrap();
        let grams = ScaleSimulation { value: 750.0, unit: "g".into(), ..Default::default() }.read().unwrap();
        assert_eq!(kg.kg, 0.75);
        assert_eq!(kg.grams, grams.grams);
        assert_eq!(kg.kg, grams.kg);
        assert!(kg.stable);
    }

    #[test]
    fn unstable_zero_and_disconnected_are_distinct() {
        let unstable = ScaleSimulation { state: "unstable".into(), ..Default::default() }.read().unwrap();
        assert!(!unstable.stable);
        let zero = ScaleSimulation { value: 0.0, tared: true, ..Default::default() }.read().unwrap();
        assert_eq!(zero.kg, 0.0);
        assert!(zero.tared);
        assert!(ScaleSimulation { state: "disconnected".into(), ..Default::default() }.read().is_err());
    }

    #[test]
    fn invalid_simulator_settings_fail_explicitly() {
        for value in [f64::NAN, f64::INFINITY, -1.0] {
            assert!(ScaleSimulation { value, ..Default::default() }.read().is_err());
        }
        assert!(ScaleSimulation { unit: "lb".into(), ..Default::default() }.read().is_err());
        assert!(ScaleSimulation { state: "unknown".into(), ..Default::default() }.read().is_err());
    }

    #[test]
    fn legacy_configs_never_enable_simulation_implicitly() {
        let mut json = serde_json::to_value(crate::hardware::HardwareConfig::default()).unwrap();
        json.as_object_mut().unwrap().remove("scale_mode");
        json.as_object_mut().unwrap().remove("scale_simulation");
        let loaded: crate::hardware::HardwareConfig = serde_json::from_value(json).unwrap();
        assert_eq!(loaded.scale_mode, ScaleMode::Physical);
    }

    #[tokio::test]
    async fn simulator_config_survives_sqlite_reload_and_physical_settings_are_preserved() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        crate::migrations::run_migrations(&pool).await.unwrap();
        let mut cfg = crate::hardware::HardwareConfig {
            scale_enabled: true, scale_mode: ScaleMode::Simulated,
            scale_port: "COM3".into(), scale_baud: 9600, scale_protocol: "cas".into(),
            ..Default::default()
        };
        cfg.scale_simulation.value = 750.0;
        cfg.scale_simulation.unit = "g".into();
        crate::hardware::save_hardware_config(&pool, &cfg).await.unwrap();
        let loaded = crate::hardware::load_hardware_config(&pool).await;
        assert_eq!(loaded.scale_mode, ScaleMode::Simulated);
        assert_eq!(loaded.scale_port, "COM3");
        assert_eq!(loaded.scale_protocol, "cas");
        assert_eq!(loaded.scale_simulation.read().unwrap().kg, 0.75);
        cfg.scale_mode = ScaleMode::Physical;
        crate::hardware::save_hardware_config(&pool, &cfg).await.unwrap();
        assert_eq!(crate::hardware::load_hardware_config(&pool).await.scale_mode, ScaleMode::Physical);
    }
}
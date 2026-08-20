use std::{env, fs::File, io::BufWriter, path::PathBuf};

use anyhow::{Context, Result, bail};
use magnus_spatial_core::{CompileOptions, compile_pbf};

fn main() -> Result<()> {
    let arguments: Vec<String> = env::args().collect();
    if arguments.len() != 6 {
        bail!(
            "usage: compile_scene <input.pbf> <output.json> <dataset-name> <center-latitude> <center-longitude>"
        );
    }

    let input = PathBuf::from(&arguments[1]);
    let output = PathBuf::from(&arguments[2]);
    let options = CompileOptions {
        dataset_name: arguments[3].clone(),
        generated_at: "generated-locally".into(),
        center_latitude: arguments[4]
            .parse()
            .context("center latitude must be a number")?,
        center_longitude: arguments[5]
            .parse()
            .context("center longitude must be a number")?,
    };

    let scene = compile_pbf(&input, &options)
        .with_context(|| format!("failed to compile {}", input.display()))?;
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let writer = BufWriter::new(File::create(&output)?);
    serde_json::to_writer_pretty(writer, &scene)?;
    println!(
        "compiled {} roadway features into {}",
        scene.features.len(),
        output.display()
    );
    Ok(())
}

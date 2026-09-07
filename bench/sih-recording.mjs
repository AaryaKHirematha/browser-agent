#!/usr/bin/env node
// ── SIH Recording Coordinator ────────────────────────────────────────────────
// Orchestrates a complete SIH demonstration recording session.
//
// This script:
//   1. Verifies all prerequisites (builds, deps, servers)
//   2. Launches the demo runner
//   3. Opens the dashboard in a second tab for split-screen recording
//   4. Logs timestamps for each scene (for chapter markers)
//   5. Generates a timestamped evidence report
//
// Usage:
//   node bench/sih-recording.mjs
//
// For actual screen recording, run OBS Studio or similar in parallel.
// This script automates the CONTENT; screen capture is external.

import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function section(title) {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"━".repeat(60)}\n`);
}

async function checkPrerequisites() {
  section("PREREQUISITE CHECK");

  const checks = [
    {
      name: "Agent build",
      check: () => fs.existsSync(path.join(ROOT, "agent/dist/server.js")),
      fix: "cd agent && npm run build",
    },
    {
      name: "Extension build",
      check: () => fs.existsSync(path.join(ROOT, "extension/dist")),
      fix: "npm run build (from root)",
    },
    {
      name: "Demo server deps",
      check: () => fs.existsSync(path.join(ROOT, "demo/node_modules")),
      fix: "cd demo && npm install",
    },
    {
      name: "Fixture files",
      check: () => {
        const fixtures = [
          "1-search.html",
          "2-dynamic-dom.html",
          "3-prompt-injection.html",
          "4-sensitive-data.html",
          "5-approval.html",
          "6-verification-failure.html",
        ];
        return fixtures.every((f) =>
          fs.existsSync(path.join(ROOT, "fixtures", f))
        );
      },
      fix: "Fixture files missing",
    },
    {
      name: "Demo public files",
      check: () => {
        const pages = [
          "index.html",
          "dynamic.html",
          "prompt-injection.html",
          "sensitive.html",
          "high-risk.html",
          "verification.html",
        ];
        return pages.every((f) =>
          fs.existsSync(path.join(ROOT, "demo/public", f))
        );
      },
      fix: "Demo pages missing from demo/public/",
    },
  ];

  let allPassed = true;
  for (const c of checks) {
    const ok = c.check();
    console.log(`  ${ok ? "✓" : "✗"} ${c.name}${ok ? "" : ` — fix: ${c.fix}`}`);
    if (!ok) allPassed = false;
  }

  if (!allPassed) {
    console.log(
      "\n⚠  Some prerequisites missing. Running auto-fix where possible...\n"
    );

    // Auto-build if needed
    if (!fs.existsSync(path.join(ROOT, "agent/dist/server.js"))) {
      console.log("Building agent...");
      try {
        execSync("npm run build", { cwd: path.join(ROOT, "agent"), stdio: "inherit" });
      } catch (e) {
        console.error("Agent build failed:", e.message);
      }
    }

    if (!fs.existsSync(path.join(ROOT, "extension/dist"))) {
      console.log("Building extension...");
      try {
        execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
      } catch (e) {
        console.error("Extension build failed:", e.message);
      }
    }

    if (!fs.existsSync(path.join(ROOT, "demo/node_modules"))) {
      console.log("Installing demo deps...");
      try {
        execSync("npm install", { cwd: path.join(ROOT, "demo"), stdio: "inherit" });
      } catch (e) {
        console.error("Demo install failed:", e.message);
      }
    }
  }

  return allPassed;
}

async function runRecordingSession() {
  section("SIH DEMONSTRATION RECORDING SESSION");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Working directory: ${ROOT}`);
  console.log("");
  
  // Start FFmpeg recording
  console.log("Starting FFmpeg desktop recording...");
  const videoPath = path.join(ROOT, "SIH_Trustworthy_Browser_Agent_Demo.mp4");
  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f", "gdigrab",
    "-framerate", "30",
    "-i", "desktop",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-crf", "18",
    videoPath
  ], {
    cwd: ROOT,
    stdio: ["pipe", "ignore", "ignore"] // ignore output to avoid terminal clutter, but keep stdin for 'q'
  });

  ffmpeg.on("error", (err) => {
    console.error("FFmpeg failed to start:", err);
  });

  console.log("FFmpeg recording started.");
  console.log(`Video will be saved to: ${videoPath}`);
  console.log("");
  console.log("Starting demo runner in 3 seconds...");
  await sleep(3000);

  // Run the demo runner
  const demoRunner = spawn(
    "node",
    [path.join(ROOT, "bench/sih-demo-runner.mjs")],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, HEADLESS: "0" }, // Always headed for recording
    }
  );

  return new Promise((resolve, reject) => {
    demoRunner.on("close", (code) => {
      console.log("\nDemo runner completed. Stopping FFmpeg...");
      if (ffmpeg.stdin) {
        ffmpeg.stdin.write("q");
      }
      setTimeout(() => {
        if (!ffmpeg.killed) ffmpeg.kill();
        if (code === 0) resolve(videoPath);
        else reject(new Error(`Demo runner exited with code ${code}`));
      }, 3000); // Wait 3s for ffmpeg to finalize
    });
    demoRunner.on("error", reject);
  });
}

async function generateReport() {
  section("POST-RECORDING REPORT");

  // Find the most recent evidence file
  const evidenceDir = path.join(ROOT, "bench/results/sih-demo");
  if (fs.existsSync(evidenceDir)) {
    const files = fs
      .readdirSync(evidenceDir)
      .filter((f) => f.startsWith("evidence-"))
      .sort()
      .reverse();
    if (files.length > 0) {
      const latest = path.join(evidenceDir, files[0]);
      const evidence = JSON.parse(fs.readFileSync(latest, "utf-8"));

      const passed = evidence.filter((e) => e.result === "PASS").length;
      const failed = evidence.filter((e) => e.result === "FAIL").length;
      const total = evidence.length;

      console.log(`Evidence file: ${latest}`);
      console.log(`Results: ${passed}/${total} PASS, ${failed} FAIL`);
      console.log("");

      // Generate validation table
      for (const e of evidence) {
        const icon =
          e.result === "PASS" ? "✅" : e.result === "FAIL" ? "❌" : "⚠️";
        console.log(`  ${icon} ${e.feature}`);
      }
    }
  }

  console.log("\n📋 Recording session complete.");
  console.log("   Next steps:");
  console.log("   1. Stop your screen recording");
  console.log("   2. Trim the video to ~7 minutes");
  console.log("   3. Add captions using docs/sih-video-script.md");
  console.log("   4. Set chapter markers from docs/sih-video-chapters.md");
  console.log("   5. Review against docs/sih-video-validation.md");
}

async function main() {
  try {
    await checkPrerequisites();
    await runRecordingSession();
    await generateReport();
  } catch (err) {
    console.error("Recording session failed:", err.message);
    process.exitCode = 1;
  }
}

main();

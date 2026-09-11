const deploymentPort = 3000;

export function buildDeploymentEnvironmentTemplate(): string {
  return [
    "# ── Database ────────────────────────────────────────────────────────────",
    "DATABASE_URL=postgresql://DB_USER:DB_PASSWORD@localhost:5432/DB_NAME",
    "",
    "# ── Session ─────────────────────────────────────────────────────────────",
    "# Generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    "SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX",
    "",
    "# ── App ─────────────────────────────────────────────────────────────────",
    "NODE_ENV=production",
    `PORT=${deploymentPort}`,
    "",
    "# ── Email (Resend) ───────────────────────────────────────────────────────",
    "# Optional — can also be configured from Settings > Email inside the app",
    "# RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx",
  ].join("\n");
}

export function buildDeploymentPm2Config(processName: string): string {
  return [
    "module.exports = {",
    "  apps: [{",
    `    name: "${processName}",`,
    "    script: \"dist/index.cjs\",",
    "    interpreter: \"node\",",
    "    env: {",
    "      NODE_ENV: \"production\",",
    `      PORT: ${deploymentPort}`,
    "    },",
    "    instances: 1,",
    "    autorestart: true,",
    "    watch: false,",
    "    max_memory_restart: \"512M\",",
    "    error_file: \"logs/err.log\",",
    "    out_file: \"logs/out.log\",",
    "    log_date_format: \"YYYY-MM-DD HH:mm:ss\"",
    "  }]",
    "};",
  ].join("\n");
}
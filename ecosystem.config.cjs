module.exports = {
  apps: [
    {
      name: "ai-dex-manager",
      cwd: "/home/deploy/ai-dex-manager",
      script: "npm",
      args: "run start",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};

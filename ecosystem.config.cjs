module.exports = {
  apps: [
    {
      name: 'speakmate',
      script: 'C:\\Users\\skore\\.bun\\bin\\bun.exe',
      args: 'run src/index.ts',
      cwd: 'C:\\Users\\skore\\speakmate',
      env: {
        NODE_ENV: 'production'
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Logs
      error_file: 'C:\\Users\\skore\\speakmate\\logs\\error.log',
      out_file: 'C:\\Users\\skore\\speakmate\\logs\\out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }
  ]
};

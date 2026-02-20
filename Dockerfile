# SpeakMate — Production Dockerfile (Railway.app)
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ src/
COPY web/ web/
COPY prompts/ prompts/

# Create dirs
RUN mkdir -p logs data

# Railway sets PORT env var — default 3478
EXPOSE ${PORT:-3478}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3478)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Start
CMD ["bun", "run", "src/index.ts"]

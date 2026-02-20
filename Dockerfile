# ALLMA — Production Dockerfile (Railway.app)
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ src/
COPY web/ web/
COPY prompts/ prompts/
COPY data/ data/

# Create logs directory
RUN mkdir -p logs

# Expose port (Railway sets PORT env var)
EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3456/health || exit 1

# Start
CMD ["bun", "run", "src/index.ts"]

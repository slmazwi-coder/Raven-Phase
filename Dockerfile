# syntax=docker/dockerfile:1
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY lib/db/package.json ./lib/db/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json

# Install dependencies (dev deps needed for the esbuild build step)
RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

# Copy source and build the api-server bundle
COPY . .
RUN pnpm --filter @workspace/api-server run build

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
CMD ["node", "artifacts/api-server/dist/index.mjs"]

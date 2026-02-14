# ── Stage 1: Build ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm install

# Copy source and build
COPY . .

# Build variant (full or tech) — set at build time
ARG VITE_VARIANT=full
ENV VITE_VARIANT=${VITE_VARIANT}

RUN npm run build

# ── Stage 2: Production ──
FROM node:22-alpine

WORKDIR /app

# Only install production deps (for api/ helpers like @upstash/redis)
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built static assets
COPY --from=builder /app/dist ./dist

# Copy API functions and server
COPY api/ ./api/
COPY server.js ./

# Runtime config
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

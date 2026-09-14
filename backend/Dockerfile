FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Create directories for uploads and keys
RUN mkdir -p uploads keys

EXPOSE 4000

CMD ["node", "dist/index.js"]

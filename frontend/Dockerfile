FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time, so the API URL must be present
# during `next build`. Passed from docker-compose build.args (defaults to the
# nginx TLS endpoint so the container's client bundle calls the API via nginx).
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# output: "standalone" traces the minimal server + node_modules into
# .next/standalone, so no package.json / npm ci is needed in this stage —
# and, critically, it's the only production artifact that actually carries
# next.config's resolved settings (e.g. images.remotePatterns) at runtime.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]

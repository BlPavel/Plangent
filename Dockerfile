FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools for native modules (node-pty, better-sqlite3)
RUN apk add --no-cache python3 make g++ tmux

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime image ----
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache tmux

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]

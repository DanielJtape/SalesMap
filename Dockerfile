FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/var/lib/salesmap
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /var/lib/salesmap && chown node:node /var/lib/salesmap
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]

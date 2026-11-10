# CarromHub — production image (Node 24 for the built-in node:sqlite)
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data TRUST_PROXY=1 ALLOWED_HOSTS=*
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
VOLUME ["/app/data"]
CMD ["node", "server.js"]

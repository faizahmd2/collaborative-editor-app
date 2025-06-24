FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p public && chown node:node public

USER node

EXPOSE 5829

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#     CMD node -e "require('http').get('http://localhost:5829/health', res => process.exit(res.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]

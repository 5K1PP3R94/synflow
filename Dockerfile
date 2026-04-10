FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN mkdir -p /data
EXPOSE 3000
ENV NODE_ENV=production
ENV DB_PATH=/data/synflow.db
ENV PORT=3000
CMD ["node", "backend/server.js"]

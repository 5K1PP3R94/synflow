FROM node:20-bookworm-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend ./backend
COPY frontend ./frontend

ENV PORT=3000
ENV DB_PATH=/data/synflow.db
EXPOSE 3000

CMD ["npm", "start"]

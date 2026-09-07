FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY . .
EXPOSE 3012
CMD ["sh", "-c", "if [ -n \"$DATA_PATH\" ]; then rm -rf /app/data && ln -s \"$DATA_PATH\" /app/data; fi && node --preserve-symlinks server.js"]

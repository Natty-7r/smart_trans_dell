FROM node:20-alpine
WORKDIR /app
# better-sqlite3 (and other native deps) need a toolchain to build/rebuild
# against musl libc when no matching prebuilt binary is available.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY . .
EXPOSE 3012
CMD ["sh", "-c", "if [ -n \"$DATA_PATH\" ]; then rm -rf /app/data && ln -s \"$DATA_PATH\" /app/data; fi && node --preserve-symlinks server.js"]

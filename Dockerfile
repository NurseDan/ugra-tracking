FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy project files
COPY . .

# Build the Vite frontend
RUN npm run build

# Start the server
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]

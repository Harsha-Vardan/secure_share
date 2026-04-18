FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Create runtime directories
RUN mkdir -p uploads/chunks logs

EXPOSE 3001

CMD ["node", "index.js"]

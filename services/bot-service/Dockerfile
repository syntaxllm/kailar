FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Set env vars to be overridden by deployment
ENV PORT=6767
ENV NODE_ENV=production

EXPOSE 6767

CMD [ "node", "index.js" ]

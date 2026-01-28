FROM node:20-bullseye

# Install Chrome deps + Xvfb
RUN apt-get update && apt-get install -y \
    xvfb \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    ca-certificates \
    fonts-liberation \
    chromium \
    --no-install-recommends

ENV DISPLAY=:99

WORKDIR /app
COPY . .
RUN npm install

CMD Xvfb :99 -screen 0 1280x720x24 & node index.js

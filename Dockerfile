# ADB//NET-CONTROL — Node backend + native android-tools-adb
FROM node:18-slim

# Installiert Abhängigkeiten für den Download und das Entpacken
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Lädt die aktuellen offiziellen Android SDK Platform-Tools direkt von Google
RUN wget -q https://dl.google.com/android/repository/platform-tools-latest-linux.zip \
    && unzip platform-tools-latest-linux.zip -d /usr/local/ \
    && rm platform-tools-latest-linux.zip

# Macht das neue ADB im gesamten System verfügbar
ENV PATH="${PATH}:/usr/local/platform-tools"

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]

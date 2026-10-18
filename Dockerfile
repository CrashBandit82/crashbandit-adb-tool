# ADB//NET-CONTROL — Node backend + native android-tools-adb
FROM node:22-slim

# Installiert Abhängigkeiten für den Download und das Entpacken
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Offizielle Android SDK Platform-Tools von Google – feste Version + Prüfsumme,
# damit jeder Build dasselbe, geprüfte ADB bekommt.
ARG PLATFORM_TOOLS_VERSION=37.0.1
ARG PLATFORM_TOOLS_SHA256=d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1
RUN wget -q -O platform-tools.zip "https://dl.google.com/android/repository/platform-tools_r${PLATFORM_TOOLS_VERSION}-linux.zip" \
    && echo "${PLATFORM_TOOLS_SHA256}  platform-tools.zip" | sha256sum -c - \
    && unzip -q platform-tools.zip -d /usr/local/ \
    && rm platform-tools.zip

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

FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY monitor.js ./

CMD ["node", "monitor.js"]

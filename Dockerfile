FROM node:18-alpine

WORKDIR /app

# Install deps first (cache-friendly)
COPY package.json ./
RUN npm install --omit=dev

# App files
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm","start"]

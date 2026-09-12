# Imagem usada apenas pelo profile "app" do docker compose.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
EXPOSE 3000
# As migrations são aplicadas na subida para o banco acompanhar o schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

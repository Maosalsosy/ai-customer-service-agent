FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# BuildKit 缓存 npm；网络不稳时可改回本机 npm run build + 仅打包 runner
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ARG NEXT_PUBLIC_WECOM_CALLBACK_BASE=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WECOM_CALLBACK_BASE=$NEXT_PUBLIC_WECOM_CALLBACK_BASE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

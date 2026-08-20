FROM node:22-alpine

WORKDIR /app

# Dependencies first so a source change does not reinstall them.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# The Prisma client is generated from the schema, so it has to be present at build time.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN yarn prisma generate

COPY . .

EXPOSE 3000
CMD ["yarn", "start:dev"]
